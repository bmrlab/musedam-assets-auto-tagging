import { hasFeatureRecognitionFailure } from "./completion";
import type { FeatureDecisionDiagnostics } from "./types";
import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import type {
  TaggingBrandBestMatch,
  TaggingBrandRecommendation,
  TaggingIpBestMatch,
  TaggingIpRecommendation,
} from "@/prisma/client";

/** Explicit arrays contain final decisions; an empty array must never revive retrieval results. */
export function getBrandMatches(
  recommendation: TaggingBrandRecommendation | null | undefined,
): TaggingBrandBestMatch[] {
  if (!recommendation) return [];
  const normalizeHistoricalMatch = (match: TaggingBrandBestMatch): TaggingBrandBestMatch => ({
    ...match,
    referenceMatchStrategy: match.referenceMatchStrategy === "average" ? "average" : "highest",
    matchedReferenceImageId: match.matchedReferenceImageId ?? null,
  });
  if (Array.isArray(recommendation.matches))
    return recommendation.matches.map(normalizeHistoricalMatch);
  if (!recommendation.bestMatch) return [];
  return [
    normalizeHistoricalMatch({
      ...recommendation.bestMatch,
      recommendedTags: [
        ...new Map(
          [
            ...(recommendation.bestMatch.recommendedTags ?? []),
            ...(recommendation.recommendedTags ?? []),
          ].map((tag) => [tag.assetTagId, tag] as const),
        ).values(),
      ],
    }),
  ];
}

export function getIpMatches(
  recommendation: TaggingIpRecommendation | null | undefined,
): TaggingIpBestMatch[] {
  if (!recommendation) return [];
  if (Array.isArray(recommendation.matches)) return recommendation.matches;
  if (!recommendation.bestMatch) return [];
  return [
    {
      ...recommendation.bestMatch,
      recommendedTags: [
        ...new Map(
          [
            ...(recommendation.bestMatch.recommendedTags ?? []),
            ...(recommendation.recommendedTags ?? []),
          ].map((tag) => [tag.assetTagId, tag] as const),
        ).values(),
      ],
    },
  ];
}

function strongestDistinct<T extends { confidence: number; similarity: number }>(
  matches: T[],
  getId: (match: T) => string,
): T[] {
  const byId = new Map<string, T>();
  for (const match of matches) {
    const id = getId(match);
    const current = byId.get(id);
    if (
      !current ||
      match.confidence > current.confidence ||
      (match.confidence === current.confidence && match.similarity > current.similarity)
    ) {
      byId.set(id, match);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.similarity - left.similarity ||
      String(getId(left)).localeCompare(String(getId(right))),
  );
}

export function getAcceptedBrandMatches(
  recommendation: TaggingBrandRecommendation | null | undefined,
): TaggingBrandBestMatch[] {
  return strongestDistinct(
    getBrandMatches(recommendation).filter((match) =>
      meetsFeatureConfidenceThreshold("brand", match.confidence, recommendation?.confidenceThreshold),
    ),
    (match) => match.assetLogoId,
  );
}

export function getAcceptedIpMatches(
  recommendation: TaggingIpRecommendation | null | undefined,
): TaggingIpBestMatch[] {
  return strongestDistinct(
    getIpMatches(recommendation).filter((match) =>
      meetsFeatureConfidenceThreshold("ip", match.confidence, recommendation?.confidenceThreshold),
    ),
    (match) => match.assetIpId,
  );
}


/** Conflict and specificity notes explain a score; they are not extra acceptance gates. */
export function getScoredFeaturePredictions(diagnostics: FeatureDecisionDiagnostics | undefined) {
  if (diagnostics?.decision.status !== "completed" || hasFeatureRecognitionFailure(diagnostics)) return [];
  return (diagnostics.decision.result?.matches ?? []).filter(match =>
    Number.isFinite(match.confidence) && match.confidence >= 0 && match.confidence <= 100,
  );
}
