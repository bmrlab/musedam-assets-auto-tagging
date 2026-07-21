import { isAcceptedPersonFace } from "@/lib/person/person-match-policy";
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

export function getAcceptedPersonRecommendationTagIds(
  personRecommendation: TaggingPersonRecommendation | null | undefined,
): number[] {
  if (!personRecommendation || !Array.isArray(personRecommendation.faces)) {
    return [];
  }

  const tagIds = new Set<number>();

  for (const face of personRecommendation.faces) {
    if (!isAcceptedPersonFace(face) || !face.bestMatch) {
      continue;
    }

    for (const tag of face.bestMatch.recommendedTags ?? []) {
      if (Number.isInteger(tag.assetTagId) && tag.assetTagId > 0) {
        tagIds.add(tag.assetTagId);
      }
    }
  }

  return [...tagIds];
}

export function getPersonRecommendationTagIdsFromQueueResult(result: unknown): number[] {
  return getAcceptedPersonRecommendationTagIds(getPersonRecommendationFromQueueResult(result));
}
