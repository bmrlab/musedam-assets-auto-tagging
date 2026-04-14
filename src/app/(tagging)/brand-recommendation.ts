import { TaggingBrandRecommendation, TaggingQueueItemResult } from "@/prisma/client";

export function getBrandRecommendationFromQueueResult(
  result: unknown,
): TaggingBrandRecommendation | null {
  const brandRecommendation = (result as TaggingQueueItemResult | null)?.brandRecommendation;

  if (!brandRecommendation || typeof brandRecommendation !== "object") {
    return null;
  }

  return brandRecommendation as TaggingBrandRecommendation;
}

export function getBrandRecommendationTagIdsFromQueueResult(result: unknown): number[] {
  const brandRecommendation = getBrandRecommendationFromQueueResult(result);

  if (
    !brandRecommendation ||
    brandRecommendation.noConfidentMatch ||
    !Array.isArray(brandRecommendation.recommendedTags)
  ) {
    return [];
  }

  return Array.from(
    new Set(
      brandRecommendation.recommendedTags
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
