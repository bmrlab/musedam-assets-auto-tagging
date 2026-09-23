import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import type { TaggingProductBestMatch, TaggingProductRecommendation } from "@/prisma/client";

type ProductMatchEvidence = {
  assetProductId: string;
  confidence: number;
  similarity: number;
  detectionIndex: number;
  detectionIndices?: number[];
};

/** Keep the strongest observation and all contributing boxes for each product. */
export function deduplicateProductMatches<T extends ProductMatchEvidence>(
  matches: T[],
): Array<T & { detectionIndices: number[] }> {
  const byProduct = new Map<string, T & { detectionIndices: number[] }>();
  for (const match of matches) {
    const current = byProduct.get(match.assetProductId);
    const detectionIndices = Array.from(
      new Set([
        ...(current?.detectionIndices ?? []),
        ...(match.detectionIndices ?? []),
        match.detectionIndex,
      ]),
    )
      .filter((index) => Number.isInteger(index) && index >= 0)
      .sort((left, right) => left - right);
    const strongest =
      !current ||
      match.confidence > current.confidence ||
      (match.confidence === current.confidence && match.similarity > current.similarity)
        ? match
        : current;
    byProduct.set(match.assetProductId, { ...strongest, detectionIndices });
  }
  return Array.from(byProduct.values()).sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.similarity - left.similarity ||
      left.assetProductId.localeCompare(right.assetProductId),
  );
}

/** New arrays are authoritative; historical queue results have only one bestMatch. */
export function getProductMatches(
  recommendation: TaggingProductRecommendation | null | undefined,
): TaggingProductBestMatch[] {
  if (!recommendation) return [];
  if (Array.isArray(recommendation.matches)) return recommendation.matches;
  if (!recommendation.bestMatch) return [];
  // Historical results only represented one product, so their aggregate tags belong to it.
  return [
    {
      ...recommendation.bestMatch,
      recommendedTags: recommendation.bestMatch.recommendedTags?.length
        ? recommendation.bestMatch.recommendedTags
        : (recommendation.recommendedTags ?? []),
    },
  ];
}

/** Every product must independently pass the same gate in classification and consumers. */
export function getAcceptedProductMatches(
  recommendation: TaggingProductRecommendation | null | undefined,
): Array<TaggingProductBestMatch & { detectionIndices: number[] }> {
  return deduplicateProductMatches(
    getProductMatches(recommendation).filter(
      (match) =>
        typeof match?.assetProductId === "string" &&
        match.assetProductId.length > 0 &&
        meetsFeatureConfidenceThreshold("product", match.confidence),
    ),
  );
}
