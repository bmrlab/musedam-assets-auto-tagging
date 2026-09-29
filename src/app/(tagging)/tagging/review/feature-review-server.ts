import "server-only";

import {
  filterFeatureLibraryRecommendations,
  isFeatureTypeEnabled,
  type FeatureLibraryFeatures,
} from "@/lib/feature-library";
import { getProductMatches } from "@/lib/product/product-match-policy";
import { getCachedBrowserS3ObjectUrl } from "@/lib/s3";
import type { TaggingQueueItemResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import {
  featureKey,
  type FeatureThumbnails,
  type ReviewFeature,
  type ReviewFeatureSearchResult,
  type ReviewFeatureType,
} from "./feature-review";

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
// 名称包含匹配的候选上限：先取候选再按相关度排序截断，避免完全匹配的特征
// 因为创建时间较早被"最新 20 条"挤掉。
const SEARCH_CANDIDATE_LIMIT = 500;

type SearchCandidate = { id: string; name: string };

function findSearchCandidates(
  type: ReviewFeatureType,
  args: {
    where: { teamId: number; enabled: true; name?: { contains: string; mode: "insensitive" } };
    take: number;
    orderBy: { createdAt: "desc" }[];
    select: { id: true; name: true };
  },
): Promise<SearchCandidate[]> {
  switch (type) {
    case "brand":
      return prisma.assetLogo.findMany(args);
    case "ip":
      return prisma.assetIp.findMany(args);
    case "product":
      return prisma.assetProduct.findMany(args);
    case "person":
      return prisma.assetPerson.findMany(args);
  }
}

/** 每个特征取排序最靠前的一张图，按类型各一次查询。 */
async function findFirstImageObjectKeys(
  type: ReviewFeatureType,
  featureIds: string[],
): Promise<Map<string, string>> {
  if (featureIds.length === 0) return new Map();
  const orderBy = [{ sort: "asc" as const }, { id: "asc" as const }];
  const rows: { featureId: string; objectKey: string }[] =
    type === "brand"
      ? (
          await prisma.assetLogoImage.findMany({
            where: { assetLogoId: { in: featureIds } },
            orderBy,
            select: { assetLogoId: true, objectKey: true },
          })
        ).map((row) => ({ featureId: row.assetLogoId, objectKey: row.objectKey }))
      : type === "ip"
        ? (
            await prisma.assetIpImage.findMany({
              where: { assetIpId: { in: featureIds } },
              orderBy,
              select: { assetIpId: true, objectKey: true },
            })
          ).map((row) => ({ featureId: row.assetIpId, objectKey: row.objectKey }))
        : type === "product"
          ? (
              await prisma.assetProductImage.findMany({
                where: { assetProductId: { in: featureIds } },
                orderBy,
                select: { assetProductId: true, objectKey: true },
              })
            ).map((row) => ({ featureId: row.assetProductId, objectKey: row.objectKey }))
          : (
              await prisma.assetPersonImage.findMany({
                where: { assetPersonId: { in: featureIds } },
                orderBy,
                select: { assetPersonId: true, objectKey: true },
              })
            ).map((row) => ({ featureId: row.assetPersonId, objectKey: row.objectKey }));
  const keys = new Map<string, string>();
  for (const row of rows) {
    if (!keys.has(row.featureId)) keys.set(row.featureId, row.objectKey);
  }
  return keys;
}

/** 批量签名特征首图，避免前端逐个特征调用 Server Action（Server Action 在客户端串行执行）。 */
export async function loadFeatureThumbnails(
  ids: Partial<Record<ReviewFeatureType, Iterable<string>>>,
): Promise<FeatureThumbnails> {
  const entries = await Promise.all(
    (Object.entries(ids) as [ReviewFeatureType, Iterable<string>][]).map(async ([type, values]) => {
      const featureIds = [...new Set(values)].filter((id) => UUID_PATTERN.test(id));
      const objectKeys = await findFirstImageObjectKeys(type, featureIds);
      return featureIds.map((id) => {
        const objectKey = objectKeys.get(id);
        return [
          featureKey(type, id),
          objectKey ? getCachedBrowserS3ObjectUrl({ objectKey }) : null,
        ] as const;
      });
    }),
  );
  return Object.fromEntries(entries.flat());
}

/** 完全匹配 > 前缀匹配 > 包含匹配；同级按名称长度，再保持创建时间倒序。 */
function rankSearchCandidates(candidates: SearchCandidate[], query: string) {
  const needle = query.toLowerCase();
  const score = (name: string) => {
    const value = name.toLowerCase();
    return value === needle ? 0 : value.startsWith(needle) ? 1 : 2;
  };
  return candidates
    .map((candidate, index) => ({ candidate, index, score: score(candidate.name) }))
    .sort(
      (a, b) =>
        a.score - b.score || a.candidate.name.length - b.candidate.name.length || a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/** Name search across the enabled feature libraries, for manually adding a feature in review. */
export async function searchReviewFeatureLibrary(
  teamId: number,
  query: string,
  enabledFeatures: FeatureLibraryFeatures,
  featureType?: ReviewFeatureType,
): Promise<ReviewFeatureSearchResult[]> {
  const types = (["brand", "ip", "product", "person"] as const).filter(
    (type) => isFeatureTypeEnabled(enabledFeatures, type) && (!featureType || featureType === type),
  );
  const name = query.trim();
  const rankedIds = await Promise.all(
    types.map(async (type) => {
      const candidates = await findSearchCandidates(type, {
        where: {
          teamId,
          enabled: true,
          ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
        },
        take: name ? SEARCH_CANDIDATE_LIMIT : SEARCH_LIMIT_PER_TYPE,
        orderBy: [{ createdAt: "desc" }],
        select: { id: true, name: true },
      });
      const ranked = name ? rankSearchCandidates(candidates, name) : candidates;
      return [type, ranked.slice(0, SEARCH_LIMIT_PER_TYPE).map(({ id }) => id)] as const;
    }),
  );
  const idsByType = Object.fromEntries(rankedIds);
  const [features, thumbnails] = await Promise.all([
    queryReviewFeatures(
      teamId,
      Object.fromEntries(rankedIds.map(([type, ids]) => [type, new Set(ids)])),
    ),
    loadFeatureThumbnails(idsByType),
  ]);
  return rankedIds.flatMap(([type, ids]) =>
    ids.flatMap((id): ReviewFeatureSearchResult[] => {
      const key = featureKey(type, id);
      const feature = features.get(key);
      return feature ? [{ ...feature, thumbnail: thumbnails[key] ?? null }] : [];
    }),
  );
}

/** Load the given IDs per type; a missing or empty set skips that type. */
async function queryReviewFeatures(
  teamId: number,
  ids: Partial<Record<ReviewFeatureType, Set<string>>>,
): Promise<Map<string, ReviewFeature>> {
  const shouldQuery = (type: ReviewFeatureType) => (ids[type]?.size ?? 0) > 0;
  const where = (type: ReviewFeatureType) => ({
    teamId,
    enabled: true,
    id: { in: [...(ids[type] ?? [])].filter((id) => UUID_PATTERN.test(id)) },
  });
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
