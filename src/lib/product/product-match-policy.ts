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
  // Some historical AI review results saved every alternative in `matches`.
  // Region winners establish ownership; alternatives cannot create extra products.
  const regionWinners = recommendation?.detections?.length ? new Map<string, number[]>() : null;
  for (const detection of recommendation?.detections ?? []) {
    if (!regionWinners || detection.noConfidentMatch || !detection.bestMatch) continue;
    const id = detection.bestMatch.assetProductId;
    regionWinners.set(id, [
      ...(regionWinners.get(id) ?? []),
      ...(detection.sourceDetectionIndices ?? [detection.detectionIndex]),
    ]);
  }
  return deduplicateProductMatches(
    getProductMatches(recommendation).flatMap((match) => {
      if (
        typeof match?.assetProductId !== "string" ||
        !match.assetProductId.length ||
        !meetsFeatureConfidenceThreshold("product", match.confidence, recommendation?.confidenceThreshold)
      )
        return [];
      if (!regionWinners || match.matchingSource === "assetName") return [match];
      const indices = regionWinners.get(match.assetProductId);
      if (!indices?.length) return [];
      return [{ ...match, detectionIndex: indices[0], detectionIndices: indices }];
    }),
  );
}
