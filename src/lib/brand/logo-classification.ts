import "server-only";

import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { queryLogoVectorPoints } from "@/lib/brand/pgvector";
import { truncateDetectionLabelToTokenLimit } from "@/lib/detection-label";
import {
  detectMediaProcessObjects,
  type MediaProcessRequestMode,
} from "@/lib/media-process/object-detection";
import type { ClassificationRemoteImageInput } from "@/lib/tagging/classification-image";
import { normalizeDetectionText } from "@/lib/utils";
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
  /** Final accepted identities, when an asset-level decision layer has run. */
  matches?: BrandTopMatch[];
  topMatches: BrandTopMatch[];
  bestMatch: BrandTopMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
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
  teamId,
  imageInput,
  detectionLabelText = "",
  requestMode = "async",
}: {
  teamId: number;
  imageInput: ClassificationRemoteImageInput;
  detectionLabelText?: string;
  requestMode?: MediaProcessRequestMode;
}) {
  const rawDetectionLabelText = detectionLabelText.trim() || "logo";
  const normalizedDetectionLabelText =
    truncateDetectionLabelToTokenLimit(normalizeDetectionText(rawDetectionLabelText)) || "logo .";
  const result = await detectMediaProcessObjects({
    teamId,
    imageInput,
    requestMode,
    detectionLabelText: normalizedDetectionLabelText,
    defaultLabel: "logo",
    errorPrefix: "Logo detection",
  });
  return { ...result, detectionLabelText: normalizedDetectionLabelText };
}

export async function classifyBrandImageCrops({
  teamId,
  crops,
  retrievalOnly = false,
}: {
  teamId: number;
  /** Return the union of each region's three strongest classes for LLM adjudication. */
  retrievalOnly?: boolean;
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
  if (embeddings.length !== crops.length) {
    throw new Error("Logo classification embedding count mismatch");
  }

  const rankedByLogo = new Map<
    string,
    {
      similarity: number;
      detectionIndex: number;
    }
  >();

  const matchGroups = await Promise.all(
    embeddings.map(async (vector, index) => ({
      index,
      matches: await queryLogoVectorPoints({
        teamId,
        vector,
        limit: LOGO_VECTOR_QUERY_LIMIT,
        scoreThreshold: LOGO_VECTOR_SCORE_THRESHOLD,
      }),
    })),
  );

  for (const { index, matches } of matchGroups) {
    for (const match of matches) {
      if (!Number.isFinite(match.score) || match.score <= 0) continue;
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
  if (retrievalOnly) {
    // Multiple reference vectors from the same class occupy just one regional slot.
    // Filter unavailable classes before choosing the three references for that region.
    rankedByLogo.clear();
    for (const { index, matches } of matchGroups) {
      const regionScores = new Map<string, number>();
      for (const match of matches) {
        const id = match.payload?.assetLogoId;
        if (
          typeof id !== "string" ||
          !logoMap.has(id) ||
          !Number.isFinite(match.score) ||
          match.score <= 0
        )
          continue;
        regionScores.set(id, Math.max(regionScores.get(id) ?? 0, match.score));
      }
      const regionCandidates = Array.from(regionScores.entries())
        .sort(([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId))
        .slice(0, 3);
      for (const [id, similarity] of regionCandidates) {
        const current = rankedByLogo.get(id);
        if (!current || similarity > current.similarity) {
          rankedByLogo.set(id, { similarity, detectionIndex: index });
        }
      }
    }
  }
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
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.assetLogoId.localeCompare(right.assetLogoId),
    )
    .slice(0, retrievalOnly ? undefined : 3);

  const confident = isConfidentWinner(topMatches);
  const bestMatch = topMatches[0] ?? null;

  return {
    topMatches,
    bestMatch,
    noConfidentMatch: retrievalOnly || !confident,
    winningDetectionIndex: bestMatch?.detectionIndex ?? null,
  };
}
