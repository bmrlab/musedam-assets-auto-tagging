import { TaggingIpRecommendation, TaggingQueueItemResult } from "@/prisma/client";

export function getIpRecommendationFromQueueResult(
  result: unknown,
): TaggingIpRecommendation | null {
  const ipRecommendation = (result as TaggingQueueItemResult | null)?.ipRecommendation;

  if (!ipRecommendation || typeof ipRecommendation !== "object") {
    return null;
  }

  return ipRecommendation as TaggingIpRecommendation;
}

export function getIpRecommendationTagIdsFromQueueResult(result: unknown): number[] {
  const ipRecommendation = getIpRecommendationFromQueueResult(result);

  if (
    !ipRecommendation ||
    ipRecommendation.noConfidentMatch ||
    !Array.isArray(ipRecommendation.recommendedTags)
  ) {
    return [];
  }

  return Array.from(
    new Set(
      ipRecommendation.recommendedTags
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
