import "server-only";

import {
  filterFeatureLibraryRecommendations,
  isFeatureTypeEnabled,
  type FeatureLibraryFeatures,
} from "@/lib/feature-library";
import { getProductMatches } from "@/lib/product/product-match-policy";
import type { TaggingQueueItemResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { featureKey, type ReviewFeature, type ReviewFeatureType } from "./feature-review";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Batch-read current, team-owned features and all their current tag associations. */
export async function loadReviewFeatureLibrary(
  teamId: number,
  results: unknown[],
  enabledFeatures: FeatureLibraryFeatures,
): Promise<Map<string, ReviewFeature>> {
  const ids: Record<ReviewFeatureType, Set<string>> = {
    brand: new Set(),
    ip: new Set(),
    product: new Set(),
    person: new Set(),
  };
  for (const value of results) {
    const result = filterFeatureLibraryRecommendations(
      (value ?? {}) as TaggingQueueItemResult,
      enabledFeatures,
    );
    if (result.brandRecommendation?.bestMatch)
      ids.brand.add(result.brandRecommendation.bestMatch.assetLogoId);
    if (result.ipRecommendation?.bestMatch) ids.ip.add(result.ipRecommendation.bestMatch.assetIpId);
    for (const product of getProductMatches(result.productRecommendation)) {
      ids.product.add(product.assetProductId);
    }
    for (const face of result.personRecommendation?.faces ?? []) {
      if (face.bestMatch) ids.person.add(face.bestMatch.assetPersonId);
    }
  }
  return queryReviewFeatures(teamId, {
    brand: ids.brand,
    ip: ids.ip,
    product: ids.product,
    person: ids.person,
  });
}

/** Parse `type:id` keys from the client into validated, enabled-type ID sets. */
function parseFeatureKeys(keys: string[], enabledFeatures: FeatureLibraryFeatures) {
  const ids: Record<ReviewFeatureType, Set<string>> = {
    brand: new Set(),
    ip: new Set(),
    product: new Set(),
    person: new Set(),
  };
  for (const key of keys) {
    const [type, id] = key.split(":") as [ReviewFeatureType, string | undefined];
    if (!(type in ids) || !id || !isFeatureTypeEnabled(enabledFeatures, type)) continue;
    ids[type].add(id);
  }
  return ids;
}

/** Load reviewer-added features; unknown, disabled, or foreign IDs are dropped silently. */
export async function loadManualReviewFeatures(
  teamId: number,
  keys: string[],
  enabledFeatures: FeatureLibraryFeatures,
): Promise<ReviewFeature[]> {
  if (keys.length === 0) return [];
  return [...(await queryReviewFeatures(teamId, parseFeatureKeys(keys, enabledFeatures))).values()];
}

const SEARCH_LIMIT_PER_TYPE = 20;

/** Name search across the enabled feature libraries, for manually adding a feature in review. */
export async function searchReviewFeatureLibrary(
  teamId: number,
  query: string,
  enabledFeatures: FeatureLibraryFeatures,
  featureType?: ReviewFeatureType,
): Promise<ReviewFeature[]> {
  const types = (["brand", "ip", "product", "person"] as const).filter(
    (type) => isFeatureTypeEnabled(enabledFeatures, type) && (!featureType || featureType === type),
  );
  const name = query.trim();
  const features = await queryReviewFeatures(
    teamId,
    Object.fromEntries(types.map((type) => [type, null])),
    { name: name ? { contains: name, mode: "insensitive" as const } : undefined },
  );
  return [...features.values()];
}

/**
 * `ids[type]` = set → load those IDs; `null` → search by `filter` (capped per type);
 * missing → skip that type.
 */
async function queryReviewFeatures(
  teamId: number,
  ids: Partial<Record<ReviewFeatureType, Set<string> | null>>,
  filter: { name?: { contains: string; mode: "insensitive" } } = {},
): Promise<Map<string, ReviewFeature>> {
  const shouldQuery = (type: ReviewFeatureType) => {
    const value = ids[type];
    return value === null || (value !== undefined && value.size > 0);
  };
  const where = (type: ReviewFeatureType) => {
    const value = ids[type];
    return value
      ? {
          teamId,
          enabled: true,
          id: { in: [...value].filter((id) => UUID_PATTERN.test(id)) },
        }
      : { teamId, enabled: true, ...filter };
  };
  const page = (type: ReviewFeatureType): { take?: number; orderBy?: { createdAt: "desc" } } =>
    ids[type] === null ? { take: SEARCH_LIMIT_PER_TYPE, orderBy: { createdAt: "desc" } } : {};
  const select = {
    id: true,
    name: true,
    tags: {
      // A local tag can be linked before it has a MuseDAM ID. Keep it visible;
      // approval resolves which tag IDs can be sent to MuseDAM separately.
      where: { assetTag: { teamId } },
      orderBy: { sort: "asc" },
      select: {
        assetTagId: true,
        assetTag: {
          select: {
            name: true,
            parent: { select: { name: true, parent: { select: { name: true } } } },
          },
        },
      },
    },
  } as const;
  const [brands, ips, products, persons] = await Promise.all([
    shouldQuery("brand")
      ? prisma.assetLogo.findMany({
          where: where("brand"),
          ...page("brand"),
          select: {
            ...select,
            logoTypeId: true,
            logoTypeName: true,
            logoType: { select: { name: true } },
          },
        })
      : [],
    shouldQuery("ip")
      ? prisma.assetIp.findMany({
          where: where("ip"),
          ...page("ip"),
          select: {
            ...select,
            ipTypeId: true,
            ipTypeName: true,
            ipType: { select: { name: true } },
            description: true,
          },
        })
      : [],
    shouldQuery("product")
      ? prisma.assetProduct.findMany({
          where: where("product"),
          ...page("product"),
          select: {
            ...select,
            productTypeId: true,
            productTypeName: true,
            productType: { select: { name: true } },
            description: true,
            generalCategory: true,
          },
        })
      : [],
    shouldQuery("person")
      ? prisma.assetPerson.findMany({
          where: where("person"),
          ...page("person"),
          select: {
            ...select,
            personTypeId: true,
            personTypeName: true,
            personType: { select: { name: true } },
          },
        })
      : [],
  ]);
  const tags = (rows: (typeof brands)[number]["tags"]): ReviewFeature["tags"] =>
    rows.flatMap((row) =>
      row.assetTagId && row.assetTag
        ? [
            {
              assetTagId: row.assetTagId,
              tagPath: [
                row.assetTag.parent?.parent?.name,
                row.assetTag.parent?.name,
                row.assetTag.name,
              ].filter((name): name is string => name !== undefined),
            },
          ]
        : [],
    );
  const features: ReviewFeature[] = [
    ...brands.map(
      (row): ReviewFeature => ({
        featureType: "brand",
        id: row.id,
        name: row.name,
        typeId: row.logoTypeId,
        typeName: row.logoType?.name ?? row.logoTypeName,
        tags: tags(row.tags),
      }),
    ),
    ...ips.map(
      (row): ReviewFeature => ({
        featureType: "ip",
        id: row.id,
        name: row.name,
        typeId: row.ipTypeId,
        typeName: row.ipType?.name ?? row.ipTypeName,
        tags: tags(row.tags),
        description: row.description,
      }),
    ),
    ...products.map(
      (row): ReviewFeature => ({
        featureType: "product",
        id: row.id,
        name: row.name,
        typeId: row.productTypeId,
        typeName: row.productType?.name ?? row.productTypeName,
        tags: tags(row.tags),
        description: row.description,
        generalCategory: row.generalCategory,
      }),
    ),
    ...persons.map(
      (row): ReviewFeature => ({
        featureType: "person",
        id: row.id,
        name: row.name,
        typeId: row.personTypeId,
        typeName: row.personType?.name ?? row.personTypeName,
        tags: tags(row.tags),
      }),
    ),
  ];
  return new Map(features.map((feature) => [featureKey(feature.featureType, feature.id), feature]));
}
