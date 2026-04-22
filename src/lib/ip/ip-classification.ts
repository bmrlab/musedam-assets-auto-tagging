import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { queryIpVectorPoints } from "@/lib/ip/qdrant";
import prisma from "@/prisma/prisma";

const IP_VECTOR_QUERY_LIMIT = 20;
const IP_VECTOR_SCORE_THRESHOLD = 0.34;
const MULTI_CROP_SUPPORT_BONUS = 0.02;
const MAX_SUPPORT_BONUS = 0.06;
const SUPPORTING_CROP_THRESHOLD = 0.46;

const CONFIDENT_WINNER_HIGH_SIMILARITY = 0.78;
const CONFIDENT_WINNER_LOW_SIMILARITY = 0.62;
const CONFIDENT_WINNER_MIN_MARGIN = 0.05;

const DEFAULT_IP_DETECTION_PROMPT =
  "mascot . character . cartoon character . anime character . virtual idol . avatar . figurine . plush toy . costume mascot . branded character . co-branded character . illustrated character";

export type IpDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type IpTopMatch = {
  assetIpId: string;
  ipName: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: Array<{
    id: string;
    assetTagId: number | null;
    tagPath: string[];
  }>;
};

export type IpClassificationResult = {
  topMatches: IpTopMatch[];
  bestMatch: IpTopMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};

type DetectionServiceResponse = {
  detections?: Array<{
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
    score?: number;
    label?: string;
  }>;
  found?: boolean;
};

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function similarityToConfidence(similarity: number) {
  return clampConfidence(similarity * 100);
}

function isConfidentWinner(topMatches: IpTopMatch[]) {
  const best = topMatches[0];
  if (!best) {
    return false;
  }

  const secondSimilarity = topMatches[1]?.similarity ?? 0;
  const margin = best.similarity - secondSimilarity;

  if (best.similarity >= CONFIDENT_WINNER_HIGH_SIMILARITY) {
    return true;
  }

  if (best.similarity < CONFIDENT_WINNER_LOW_SIMILARITY) {
    return false;
  }

  return margin >= CONFIDENT_WINNER_MIN_MARGIN;
}

function normalizeDetectionPromptTerm(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[。！!？?]/g, " ")
    .trim();
}

async function fetchIpDetectionPromptNames(teamId: number) {
  const ips = await prisma.assetIp.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true,
      ipTypeName: true,
    },
    take: 40,
  });

  const promptNames = Array.from(
    new Set(
      ips
        .flatMap((ip) => [ip.name, ip.ipTypeName])
        .map((value) => normalizeDetectionPromptTerm(value))
        .filter(Boolean),
    ),
  );

  return [DEFAULT_IP_DETECTION_PROMPT, ...promptNames].join(" . ");
}

type CropAggregation = {
  imageSimilarity: number;
  descriptionSimilarity: number;
};

function computeCropScore(aggregation: CropAggregation) {
  if (aggregation.imageSimilarity > 0 && aggregation.descriptionSimilarity > 0) {
    return aggregation.imageSimilarity * 0.82 + aggregation.descriptionSimilarity * 0.18;
  }

  if (aggregation.imageSimilarity > 0) {
    return aggregation.imageSimilarity;
  }

  return aggregation.descriptionSimilarity * 0.92;
}

export async function detectIpFigureBoxes({
  teamId,
  imageUrl,
}: {
  teamId: number;
  imageUrl: string;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const detectionLabelText = await fetchIpDetectionPromptNames(teamId);
  const response = await fetch(`${baseUrl}/object_detection_groundingDINO`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      detection_label_text: detectionLabelText,
    }),
  });

  const payload = (await response.json().catch(() => null)) as DetectionServiceResponse | null;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`IP detection request failed (${response.status}) ${JSON.stringify(errorBody)}`);
    throw new Error(`IP detection request failed (${response.status})`);
  }

  return {
    detections:
      payload?.detections?.map((item) => ({
        xMin: item.x_min,
        yMin: item.y_min,
        xMax: item.x_max,
        yMax: item.y_max,
        score: item.score ?? 0,
        label: item.label ?? "ip figure",
      })) ?? [],
    found: Boolean(payload?.found),
  };
}

export async function classifyIpImageCrops({
  teamId,
  crops,
}: {
  teamId: number;
  crops: Array<{
    box: IpDetectionBox;
    image: string;
  }>;
}): Promise<IpClassificationResult> {
  if (crops.length === 0) {
    return {
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const embeddings = await createJinaImageEmbeddings({
    images: crops.map((crop) => crop.image),
    task: "retrieval.query",
  });

  const rankedByIp = new Map<
    string,
    {
      similarity: number;
      detectionIndex: number;
      imageSimilarity: number;
      descriptionSimilarity: number;
      supportingDetections: Set<number>;
    }
  >();

  for (let index = 0; index < embeddings.length; index += 1) {
    const matches = await queryIpVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: IP_VECTOR_QUERY_LIMIT,
      scoreThreshold: IP_VECTOR_SCORE_THRESHOLD,
    });

    const cropMatches = new Map<string, CropAggregation>();

    for (const match of matches) {
      const assetIpId = match.payload?.assetIpId;
      if (!assetIpId || typeof assetIpId !== "string") {
        continue;
      }

      const sourceType = match.payload?.sourceType === "description" ? "description" : "image";
      const current = cropMatches.get(assetIpId) ?? {
        imageSimilarity: 0,
        descriptionSimilarity: 0,
      };

      if (sourceType === "description") {
        current.descriptionSimilarity = Math.max(current.descriptionSimilarity, match.score);
      } else {
        current.imageSimilarity = Math.max(current.imageSimilarity, match.score);
      }

      cropMatches.set(assetIpId, current);
    }

    for (const [assetIpId, aggregation] of cropMatches.entries()) {
      const cropScore = computeCropScore(aggregation);
      const current = rankedByIp.get(assetIpId) ?? {
        similarity: 0,
        detectionIndex: index,
        imageSimilarity: 0,
        descriptionSimilarity: 0,
        supportingDetections: new Set<number>(),
      };

      if (cropScore >= SUPPORTING_CROP_THRESHOLD) {
        current.supportingDetections.add(index);
      }

      if (cropScore > current.similarity) {
        current.similarity = cropScore;
        current.detectionIndex = index;
        current.imageSimilarity = aggregation.imageSimilarity;
        current.descriptionSimilarity = aggregation.descriptionSimilarity;
      }

      rankedByIp.set(assetIpId, current);
    }
  }

  const matchedIpIds = Array.from(rankedByIp.keys());
  if (matchedIpIds.length === 0) {
    return {
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const ips = await prisma.assetIp.findMany({
    where: {
      teamId,
      id: {
        in: matchedIpIds,
      },
      enabled: true,
      status: "completed",
    },
    select: {
      id: true,
      name: true,
      ipTypeId: true,
      ipTypeName: true,
      description: true,
      tags: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
        select: {
          id: true,
          assetTagId: true,
          tagPath: true,
        },
      },
    },
  });

  const ipMap = new Map(ips.map((ip) => [ip.id, ip]));
  const topMatches = matchedIpIds
    .map((assetIpId) => {
      const stats = rankedByIp.get(assetIpId);
      const ip = ipMap.get(assetIpId);

      if (!stats || !ip) {
        return null;
      }

      const supportBonus = Math.min(
        MAX_SUPPORT_BONUS,
        Math.max(0, stats.supportingDetections.size - 1) * MULTI_CROP_SUPPORT_BONUS,
      );
      const similarity = Math.min(0.99, stats.similarity + supportBonus);

      return {
        assetIpId,
        ipName: ip.name,
        ipTypeId: ip.ipTypeId,
        ipTypeName: ip.ipTypeName,
        description: ip.description,
        similarity,
        confidence: similarityToConfidence(similarity),
        detectionIndex: stats.detectionIndex,
        imageSimilarity: stats.imageSimilarity,
        descriptionSimilarity: stats.descriptionSimilarity,
        recommendedTags: ip.tags.map((tag) => ({
          id: tag.id,
          assetTagId: tag.assetTagId,
          tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
        })),
      } satisfies IpTopMatch;
    })
    .filter((match): match is IpTopMatch => Boolean(match))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3);

  const confident = isConfidentWinner(topMatches);
  const bestMatch = topMatches[0] ?? null;

  return {
    topMatches,
    bestMatch,
    noConfidentMatch: !confident,
    winningDetectionIndex: bestMatch?.detectionIndex ?? null,
  };
}
