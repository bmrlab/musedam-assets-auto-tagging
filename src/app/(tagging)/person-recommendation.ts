import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
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

  if (!personRecommendation || !Array.isArray(personRecommendation.faces)) {
    return [];
  }

  const tagIds = new Set<number>();

  for (const face of personRecommendation.faces) {
    if (
      !face.bestMatch ||
      !meetsFeatureConfidenceThreshold("person", face.bestMatch.confidence)
    ) {
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
