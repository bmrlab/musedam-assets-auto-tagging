import { getAcceptedProductMatches } from "@/lib/product/product-match-policy";
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

  return Array.from(
    new Set(
      getAcceptedProductMatches(productRecommendation)
        .flatMap((match) => match.recommendedTags ?? [])
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
