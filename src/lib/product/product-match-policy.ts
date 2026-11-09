import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import type { TaggingProductBestMatch, TaggingProductRecommendation } from "@/prisma/client";

type ProductMatchEvidence = {
  assetProductId: string;
  matchingSource?: "assetName";
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

type ProductRegion = {
  detectionIndex: number;
  sourceDetectionIndices?: number[];
  bestMatch?: { detectionIndices?: number[] } | null;
  topMatches: Array<{ assetProductId: string; similarity: number }>;
};

/** One scored catalog identity per source region, then deduplicate repeated products. */
export function selectProductRegionWinners<T extends ProductMatchEvidence>(
  matches: T[],
  regions: ProductRegion[],
): Array<T & { detectionIndices: number[] }> {
  const candidates = deduplicateProductMatches(matches.filter(match => Number.isFinite(match.confidence)));
  const represented = new Set(regions.map(region => region.detectionIndex));
  const groups = regions.length ? regions.map(region => ({
    index: region.detectionIndex,
    indices: (region.sourceDetectionIndices?.length ? region.sourceDetectionIndices
      : region.bestMatch?.detectionIndices?.length ? region.bestMatch.detectionIndices : [region.detectionIndex])
      .filter(index => index === region.detectionIndex || !represented.has(index)),
    ids: new Set(region.topMatches.map(match => match.assetProductId)),
    similarities: new Map(region.topMatches.map(match => [match.assetProductId, match.similarity])),
  })) : [...new Set(candidates.flatMap(match => match.detectionIndices.length ? match.detectionIndices : [match.detectionIndex]))]
    .map(index => ({ index, indices: [index], ids: new Set<string>(), similarities: new Map<string, number>() }));
  const winners: Array<T & { detectionIndices: number[] }> = [];
  for (const group of groups) {
    const eligible = candidates.filter(match =>
      group.ids.size ? group.ids.has(match.assetProductId) :
        match.detectionIndices.includes(group.index) || (!regions.length && match.detectionIndex === group.index),
    );
    eligible.sort((left, right) => right.confidence - left.confidence ||
      (group.similarities.get(right.assetProductId) ?? right.similarity) -
      (group.similarities.get(left.assetProductId) ?? left.similarity) ||
      left.assetProductId.localeCompare(right.assetProductId));
    const winner = eligible[0];
    if (winner) winners.push({ ...winner, detectionIndex: group.index, detectionIndices: group.indices });
  }
  // Complete filename identities without a localized region remain independent evidence.
  winners.push(...candidates.filter(match => match.matchingSource === "assetName" &&
    !winners.some(winner => winner.assetProductId === match.assetProductId)));
  return deduplicateProductMatches(winners);
}

/** Classification, review, application and bindings share the same regional winners. */
export function getAcceptedProductMatches(
  recommendation: TaggingProductRecommendation | null | undefined,
): Array<TaggingProductBestMatch & { detectionIndices: number[] }> {
  return selectProductRegionWinners(
    getProductMatches(recommendation).filter(match =>
      typeof match?.assetProductId === "string" && match.assetProductId.length > 0 &&
      meetsFeatureConfidenceThreshold("product", match.confidence, recommendation?.confidenceThreshold)),
    recommendation?.detections ?? [],
  );
}
