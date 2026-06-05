import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { queryIpVectorPoints } from "@/lib/ip/pgvector";
import { translateDetectionLabelText } from "@/lib/translation/service";
import { normalizeDetectionText } from "@/lib/utils";
import prisma from "@/prisma/prisma";
import { DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME } from "./match-pattern";

const IP_IMAGE_VECTOR_QUERY_LIMIT = 20;
const IP_IMAGE_VECTOR_SCORE_THRESHOLD = 0.34;
const IP_DESCRIPTION_VECTOR_QUERY_LIMIT = 60;
const DESCRIPTION_SUPPORT_WEIGHT = 0.2;
const DESCRIPTION_ONLY_WEIGHT = 0.7;
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
      images: {
        where: {
          partialMatchPatternName: {
            not: null,
          },
        },
        select: {
          partialMatchPatternName: true,
        },
      },
    },
    take: 40,
  });

  const customPromptTerms = Array.from(
    new Set(
      ips
        .flatMap((ip) => [
          ip.name,
          ip.ipTypeName,
          ...ip.images.map((image) => image.partialMatchPatternName),
        ])
        .map((value) => normalizeDetectionPromptTerm(value ?? ""))
        .filter(Boolean),
    ),
  );

  return [DEFAULT_IP_DETECTION_PROMPT, ...customPromptTerms].join(" . ");
}

type CropAggregation = {
  imageSimilarity: number;
  descriptionSimilarity: number;
};

function computeCropScore(aggregation: CropAggregation) {
  if (aggregation.imageSimilarity > 0 && aggregation.descriptionSimilarity > 0) {
    return Math.min(
      0.99,
      aggregation.imageSimilarity + aggregation.descriptionSimilarity * DESCRIPTION_SUPPORT_WEIGHT,
    );
  }

  if (aggregation.imageSimilarity > 0) {
    return aggregation.imageSimilarity;
  }

  return aggregation.descriptionSimilarity * DESCRIPTION_ONLY_WEIGHT;
}

export async function detectIpFigureBoxes({
  teamId,
  imageBase64,
}: {
  teamId: number;
  imageBase64: string;
}) {
  const detectionLabelText = normalizeDetectionText(
    await translateDetectionLabelText(await fetchIpDetectionPromptNames(teamId)),
  );
  if (!detectionLabelText) {
    throw new Error("IP detection_label_text is empty after normalization");
  }

  return requestIpDetection({
    imageBase64,
    detectionLabelText,
    errorPrefix: "IP detection",
  });
}

export async function detectIpPartialFeatureBoxes({
  imageBase64,
  partialMatchPatternName = DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
}: {
  imageBase64: string;
  partialMatchPatternName?: string;
}) {
  const normalizedPatternName = normalizeDetectionPromptTerm(partialMatchPatternName);
  const rawPatternLabelText =
    normalizedPatternName || normalizeDetectionPromptTerm(DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME);
  const translatedPatternLabelText = rawPatternLabelText
    ? await translateDetectionLabelText(rawPatternLabelText)
    : "";
  const detectionLabelText =
    normalizeDetectionText(translatedPatternLabelText || rawPatternLabelText) ||
    normalizeDetectionText(DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME);

  if (!detectionLabelText) {
    throw new Error("IP partial feature detection_label_text is empty after normalization");
  }

  return requestIpDetection({
    imageBase64,
    detectionLabelText,
    errorPrefix: "IP partial feature detection",
  });
}

async function requestIpDetection({
  imageBase64,
  detectionLabelText,
  errorPrefix,
}: {
  imageBase64: string;
  detectionLabelText: string;
  errorPrefix: string;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const response = await fetch(`${baseUrl}/object_detection_groundingDINO`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_base64: imageBase64,
      detection_label_text: detectionLabelText,
    }),
  });

  const responseText = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(responseText) as DetectionServiceResponse;
    } catch {
      return null;
    }
  })();

  if (!response.ok) {
    console.error(`${errorPrefix} request failed (${response.status}) ${responseText}`);
    throw new Error(`${errorPrefix} request failed (${response.status})`);
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
    const imageMatches = await queryIpVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: IP_IMAGE_VECTOR_QUERY_LIMIT,
      scoreThreshold: IP_IMAGE_VECTOR_SCORE_THRESHOLD,
      sourceType: "image",
    });
    const descriptionMatches = await queryIpVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: IP_DESCRIPTION_VECTOR_QUERY_LIMIT,
      sourceType: "description",
    });
    const matches = [...imageMatches, ...descriptionMatches];

    const cropMatches = new Map<string, CropAggregation>();

    for (const match of matches) {
      if (match.score <= 0) {
        continue;
      }

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
