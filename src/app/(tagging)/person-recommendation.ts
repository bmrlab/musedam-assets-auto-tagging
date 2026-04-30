import type { TaggingPersonRecommendation, TaggingQueueItemResult } from "@/prisma/client";

export function getPersonRecommendationFromQueueResult(
  result: unknown,
): TaggingPersonRecommendation | null {
  const personRecommendation = (result as TaggingQueueItemResult | null)?.personRecommendation;

  if (!personRecommendation || typeof personRecommendation !== "object") {
    return null;
  }

  return personRecommendation as TaggingPersonRecommendation;
}

export function getPersonRecommendationTagIdsFromQueueResult(result: unknown): number[] {
  const personRecommendation = getPersonRecommendationFromQueueResult(result);

  if (
    !personRecommendation ||
    personRecommendation.noConfidentMatch ||
    !Array.isArray(personRecommendation.recommendedTags)
  ) {
    return [];
  }

  return Array.from(
    new Set(
      personRecommendation.recommendedTags
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    ),
  );
}
