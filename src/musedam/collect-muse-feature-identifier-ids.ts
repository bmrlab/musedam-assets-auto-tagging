import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import type {
  TaggingBrandRecommendation,
  TaggingIpRecommendation,
  TaggingPersonRecommendation,
  TaggingProductRecommendation,
} from "@/prisma/client";

function approvedTagsOverlap(
  approvedTagIds: number[],
  candidateTagRows: { assetTagId: number }[] | null | undefined,
): boolean {
  if (approvedTagIds.length === 0 || !candidateTagRows?.length) {
    return false;
  }
  const approved = new Set(approvedTagIds);
  return candidateTagRows.some((row) => approved.has(row.assetTagId));
}

/**
 * Collect MuseDAM feature `identifierId` values for a single queue result, given which
 * feature-related asset tag ids are being applied (e.g. after rejection filters).
 */
export function collectMuseFeatureIdentifierIdsForQueueItem({
  brandRecommendation,
  ipRecommendation,
  productRecommendation,
  personRecommendation,
  brandTagIds,
  ipTagIds,
  productTagIds,
  personTagIds,
}: {
  brandRecommendation: TaggingBrandRecommendation | null | undefined;
  ipRecommendation: TaggingIpRecommendation | null | undefined;
  productRecommendation: TaggingProductRecommendation | null | undefined;
  personRecommendation: TaggingPersonRecommendation | null | undefined;
  brandTagIds: number[];
  ipTagIds: number[];
  productTagIds: number[];
  personTagIds: number[];
}): string[] {
  const ids = new Set<string>();

  const brand = brandRecommendation;
  if (
    brand?.bestMatch &&
    meetsFeatureConfidenceThreshold("brand", brand.bestMatch.confidence)
  ) {
    const tagRows = [
      ...(brand.bestMatch.recommendedTags ?? []),
      ...(brand.recommendedTags ?? []),
    ];
    if (approvedTagsOverlap(brandTagIds, tagRows)) {
      ids.add(brand.bestMatch.assetLogoId);
    }
  }

  const ip = ipRecommendation;
  if (ip?.bestMatch && meetsFeatureConfidenceThreshold("ip", ip.bestMatch.confidence)) {
    const tagRows = [...(ip.bestMatch.recommendedTags ?? []), ...(ip.recommendedTags ?? [])];
    if (approvedTagsOverlap(ipTagIds, tagRows)) {
      ids.add(ip.bestMatch.assetIpId);
    }
  }

  const product = productRecommendation;
  if (
    product?.bestMatch &&
    meetsFeatureConfidenceThreshold("product", product.bestMatch.confidence)
  ) {
    const tagRows = [
      ...(product.bestMatch.recommendedTags ?? []),
      ...(product.recommendedTags ?? []),
    ];
    if (approvedTagsOverlap(productTagIds, tagRows)) {
      ids.add(product.bestMatch.assetProductId);
    }
  }

  const person = personRecommendation;
  if (person) {
    for (const row of person.recommendedTags ?? []) {
      if (personTagIds.includes(row.assetTagId) && row.assetPersonId) {
        ids.add(row.assetPersonId);
      }
    }
    for (const face of person.faces ?? []) {
      const bm = face.bestMatch;
      if (!bm || !meetsFeatureConfidenceThreshold("person", bm.confidence)) {
        continue;
      }
      if (approvedTagsOverlap(personTagIds, bm.recommendedTags)) {
        ids.add(bm.assetPersonId);
      }
    }
  }

  return [...ids];
}
