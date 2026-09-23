import { isReviewablePersonFace } from "@/lib/person/person-match-policy";
import { getAcceptedProductMatches, getProductMatches } from "@/lib/product/product-match-policy";
import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import type { TaggingQueueItemResult } from "@/prisma/client";

export type ReviewFeatureType = "brand" | "ip" | "product" | "person";
export type ReviewFeature = {
  featureType: ReviewFeatureType;
  id: string;
  name: string;
  typeId: string | null;
  typeName: string;
  tags: { assetTagId: number; tagPath: string[] }[];
  description?: string;
  generalCategory?: string;
};

export type FeatureReviewVersions = Record<string, string>;
export const FEATURE_REVIEW_CHANGED = "featureReviewChanged";
export const featureKey = (type: ReviewFeatureType, id: string) => `${type}:${id}`;

/** Classification evidence stays fixed; only library metadata and associations are refreshed. */
export function hydrateReviewFeatures(
  result: unknown,
  features: Map<string, ReviewFeature>,
): TaggingQueueItemResult {
  const source = (result ?? {}) as TaggingQueueItemResult;
  const hydrated = { ...source };
  const brand = source.brandRecommendation;
  if (brand?.bestMatch) {
    const feature = features.get(featureKey("brand", brand.bestMatch.assetLogoId));
    hydrated.brandRecommendation = feature
      ? {
          ...brand,
          bestMatch: {
            ...brand.bestMatch,
            logoName: feature.name,
            logoTypeId: feature.typeId,
            logoTypeName: feature.typeName,
            recommendedTags: feature.tags,
          },
          recommendedTags: feature.tags,
        }
      : null;
  }
  const ip = source.ipRecommendation;
  if (ip?.bestMatch) {
    const feature = features.get(featureKey("ip", ip.bestMatch.assetIpId));
    hydrated.ipRecommendation = feature
      ? {
          ...ip,
          bestMatch: {
            ...ip.bestMatch,
            ipName: feature.name,
            ipTypeId: feature.typeId,
            ipTypeName: feature.typeName,
            description: feature.description ?? "",
            recommendedTags: feature.tags,
          },
          recommendedTags: feature.tags,
        }
      : null;
  }
  const product = source.productRecommendation;
  if (product) {
    const matches = getProductMatches(product).flatMap((match) => {
      const feature = features.get(featureKey("product", match.assetProductId));
      return feature
        ? [
            {
              ...match,
              productName: feature.name,
              productTypeId: feature.typeId,
              productTypeName: feature.typeName,
              description: feature.description ?? "",
              generalCategory: feature.generalCategory ?? "",
              recommendedTags: feature.tags,
            },
          ]
        : [];
    });
    const hasMatchesArray = Array.isArray(product.matches);
    hydrated.productRecommendation =
      hasMatchesArray || matches.length > 0
        ? {
            ...product,
            ...(hasMatchesArray ? { matches } : {}),
            bestMatch: matches[0] ?? null,
            noConfidentMatch: matches.length === 0 || product.noConfidentMatch,
            recommendedTags: [
              ...new Map(
                matches.flatMap((match) =>
                  match.recommendedTags.map((tag) => [tag.assetTagId, tag] as const),
                ),
              ).values(),
            ],
          }
        : null;
  }
  const person = source.personRecommendation;
  if (person) {
    const faces = person.faces.map((face) => {
      const match = face.bestMatch;
      if (!match) return face;
      const feature = features.get(featureKey("person", match.assetPersonId));
      if (!feature) return { ...face, bestMatch: null };
      const bestMatch = {
        ...match,
        personName: feature.name,
        personTypeId: feature.typeId,
        personTypeName: feature.typeName,
        recommendedTags: feature.tags.map((tag) => ({
          ...tag,
          assetPersonId: match.assetPersonId,
          personName: feature.name,
          detectionIndex: face.detectionIndex,
          confidence: match.confidence,
        })),
      };
      // Preserve the original ranking and similarity evidence used by the review policy.
      return { ...face, bestMatch };
    });
    hydrated.personRecommendation = {
      ...person,
      faces,
      recommendedTags: faces.flatMap((face) => face.bestMatch?.recommendedTags ?? []),
    };
  }
  return hydrated;
}

/** Eligible feature IDs are independent of whether the feature has any tags. */
export function getReviewFeatures(result: unknown): ReviewFeature[] {
  const source = (result ?? {}) as TaggingQueueItemResult;
  const features: ReviewFeature[] = [];
  const brand = source.brandRecommendation?.bestMatch;
  if (brand && meetsFeatureConfidenceThreshold("brand", brand.confidence)) {
    features.push({
      featureType: "brand",
      id: brand.assetLogoId,
      name: brand.logoName,
      typeId: brand.logoTypeId,
      typeName: brand.logoTypeName,
      tags: brand.recommendedTags ?? [],
    });
  }
  const ip = source.ipRecommendation?.bestMatch;
  if (ip && meetsFeatureConfidenceThreshold("ip", ip.confidence)) {
    features.push({
      featureType: "ip",
      id: ip.assetIpId,
      name: ip.ipName,
      typeId: ip.ipTypeId,
      typeName: ip.ipTypeName,
      tags: ip.recommendedTags ?? [],
      description: ip.description,
    });
  }
  for (const product of getAcceptedProductMatches(source.productRecommendation)) {
    features.push({
      featureType: "product",
      id: product.assetProductId,
      name: product.productName,
      typeId: product.productTypeId,
      typeName: product.productTypeName,
      tags: product.recommendedTags ?? [],
      description: product.description,
      generalCategory: product.generalCategory,
    });
  }
  for (const face of source.personRecommendation?.faces ?? []) {
    const match = face.bestMatch;
    if (match && isReviewablePersonFace(face)) {
      features.push({
        featureType: "person",
        id: match.assetPersonId,
        name: match.personName,
        typeId: match.personTypeId,
        typeName: match.personTypeName,
        tags: (match.recommendedTags ?? []).map(({ assetTagId, tagPath }) => ({
          assetTagId,
          tagPath,
        })),
      });
    }
  }
  return [
    ...new Map(
      features.map((feature) => [featureKey(feature.featureType, feature.id), feature]),
    ).values(),
  ];
}

export function getFeatureReviewVersion(result: unknown): string {
  return JSON.stringify(
    getReviewFeatures(result)
      .map((feature) => ({
        ...feature,
        tags: [...feature.tags].sort((a, b) => a.assetTagId - b.assetTagId),
      }))
      .sort((a, b) =>
        featureKey(a.featureType, a.id).localeCompare(featureKey(b.featureType, b.id)),
      ),
  );
}

export function getFeatureReviewVersions(
  batch: {
    queueItem: { id: number; taskType: string; result: unknown };
    taggingAuditItems?: { status: string }[];
  }[],
): FeatureReviewVersions {
  let hasDefault = false;
  return Object.fromEntries(
    batch
      .filter(({ queueItem, taggingAuditItems }) => {
        if (taggingAuditItems && !taggingAuditItems.some(({ status }) => status === "pending"))
          return false;
        if (queueItem.taskType !== "default") return true;
        if (hasDefault) return false;
        hasDefault = true;
        return true;
      })
      .map(({ queueItem }) => [queueItem.id, getFeatureReviewVersion(queueItem.result)]),
  );
}

export function selectReviewFeatures(results: unknown[], rejectedKeys: string[] = []) {
  const rejected = new Set(rejectedKeys);
  return [
    ...new Map(
      results
        .flatMap(getReviewFeatures)
        .filter((feature) => !rejected.has(featureKey(feature.featureType, feature.id)))
        .map((feature) => [featureKey(feature.featureType, feature.id), feature]),
    ).values(),
  ];
}

export function createFeatureReviewSnapshot(result: unknown, selected: ReviewFeature[]) {
  const hydrated = hydrateReviewFeatures(
    result,
    new Map(selected.map((feature) => [featureKey(feature.featureType, feature.id), feature])),
  );
  const product = hydrated.productRecommendation;
  if (product?.detections) {
    const selectedProductIds = new Set(
      getProductMatches(product).map((match) => match.assetProductId),
    );
    hydrated.productRecommendation = {
      ...product,
      detections: product.detections.map((detection) => {
        const bestMatch =
          detection.bestMatch && selectedProductIds.has(detection.bestMatch.assetProductId)
            ? detection.bestMatch
            : null;
        return {
          ...detection,
          bestMatch,
          topMatches: detection.topMatches.filter((match) =>
            selectedProductIds.has(match.assetProductId),
          ),
          noConfidentMatch: !bestMatch || detection.noConfidentMatch,
        };
      }),
    };
  }
  return {
    reviewedAt: new Date().toISOString(),
    result: {
      brandRecommendation: hydrated.brandRecommendation ?? null,
      ipRecommendation: hydrated.ipRecommendation ?? null,
      productRecommendation: hydrated.productRecommendation ?? null,
      personRecommendation: hydrated.personRecommendation ?? null,
    },
  };
}

export function getReviewedFeatureResult(result: unknown, extra: unknown): TaggingQueueItemResult {
  const review = (
    extra as { featureReview?: ReturnType<typeof createFeatureReviewSnapshot> } | null
  )?.featureReview;
  return { ...(result as TaggingQueueItemResult), ...review?.result };
}
