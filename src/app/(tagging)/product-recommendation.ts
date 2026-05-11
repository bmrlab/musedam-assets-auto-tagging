import { TaggingProductRecommendation, TaggingQueueItemResult } from "@/prisma/client";

export function getProductRecommendationFromQueueResult(
  result: unknown,
): TaggingProductRecommendation | null {
  const productRecommendation = (result as TaggingQueueItemResult | null)?.productRecommendation;

  if (!productRecommendation || typeof productRecommendation !== "object") {
    return null;
  }

  return productRecommendation as TaggingProductRecommendation;
}

export function getProductRecommendationTagIdsFromQueueResult(result: unknown): number[] {
  const productRecommendation = getProductRecommendationFromQueueResult(result);

  if (
    !productRecommendation ||
    productRecommendation.noConfidentMatch ||
    !Array.isArray(productRecommendation.recommendedTags)
  ) {
    return [];
  }

  return Array.from(
    new Set(
      productRecommendation.recommendedTags
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
