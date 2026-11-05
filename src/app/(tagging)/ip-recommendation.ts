import { getAcceptedIpMatches } from "@/lib/feature-decision/match-policy";
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

  return Array.from(
    new Set(
      getAcceptedIpMatches(ipRecommendation)
        .flatMap((match) => match.recommendedTags ?? [])
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
