import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { queryLogoVectorPoints } from "@/lib/brand/qdrant";
import prisma from "@/prisma/prisma";

const LOGO_VECTOR_QUERY_LIMIT = 12;
const LOGO_VECTOR_SCORE_THRESHOLD = 0.45;

const CONFIDENT_WINNER_HIGH_SIMILARITY = 0.83;
const CONFIDENT_WINNER_LOW_SIMILARITY = 0.68;
const CONFIDENT_WINNER_MIN_MARGIN = 0.04;

export type BrandDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type BrandTopMatch = {
  assetLogoId: string;
  logoName: string;
  logoTypeId: string | null;
  logoTypeName: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
};

export type BrandClassificationResult = {
  topMatches: BrandTopMatch[];
  bestMatch: BrandTopMatch | null;
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

function isConfidentWinner(topMatches: BrandTopMatch[]) {
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

export async function detectBrandLogoBoxes({
  teamId: _teamId,
  imageUrl,
  detectionLabelText = "",
}: {
  teamId: number;
  imageUrl: string;
  detectionLabelText?: string;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const normalizedDetectionLabelText = detectionLabelText.trim() || "logo";
  const response = await fetch(`${baseUrl}/object_detection_groundingDINO`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      detection_label_text: normalizedDetectionLabelText,
    }),
  });

  const payload = (await response.json().catch(() => null)) as DetectionServiceResponse | null;
  if (!response.ok) {
    throw new Error(`Logo detection request failed (${response.status})`);
  }

  return {
    detections:
      payload?.detections?.map((item) => ({
        xMin: item.x_min,
        yMin: item.y_min,
        xMax: item.x_max,
        yMax: item.y_max,
        score: item.score ?? 0,
        label: item.label ?? "logo",
      })) ?? [],
    found: Boolean(payload?.found),
  };
}

export async function classifyBrandImageCrops({
  teamId,
  crops,
}: {
  teamId: number;
  crops: Array<{
    box: BrandDetectionBox;
    image: string;
  }>;
}): Promise<BrandClassificationResult> {
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

  const rankedByLogo = new Map<
    string,
    {
      similarity: number;
      detectionIndex: number;
    }
  >();

  for (let index = 0; index < embeddings.length; index += 1) {
    const matches = await queryLogoVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: LOGO_VECTOR_QUERY_LIMIT,
      scoreThreshold: LOGO_VECTOR_SCORE_THRESHOLD,
    });

    for (const match of matches) {
      const assetLogoId = match.payload?.assetLogoId;
      if (!assetLogoId || typeof assetLogoId !== "string") {
        continue;
      }

      const current = rankedByLogo.get(assetLogoId);
      if (!current || match.score > current.similarity) {
        rankedByLogo.set(assetLogoId, {
          similarity: match.score,
          detectionIndex: index,
        });
      }
    }
  }

  const matchedLogoIds = Array.from(rankedByLogo.keys());
  if (matchedLogoIds.length === 0) {
    return {
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
      id: {
        in: matchedLogoIds,
      },
      enabled: true,
      status: "completed",
    },
    select: {
      id: true,
      name: true,
      logoTypeId: true,
      logoTypeName: true,
    },
  });

  const logoMap = new Map(logos.map((logo) => [logo.id, logo]));
  const topMatches = matchedLogoIds
    .map((assetLogoId) => {
      const stats = rankedByLogo.get(assetLogoId);
      const logo = logoMap.get(assetLogoId);

      if (!stats || !logo) {
        return null;
      }

      return {
        assetLogoId,
        logoName: logo.name,
        logoTypeId: logo.logoTypeId,
        logoTypeName: logo.logoTypeName,
        similarity: stats.similarity,
        confidence: similarityToConfidence(stats.similarity),
        detectionIndex: stats.detectionIndex,
      } satisfies BrandTopMatch;
    })
    .filter((match): match is BrandTopMatch => Boolean(match))
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
