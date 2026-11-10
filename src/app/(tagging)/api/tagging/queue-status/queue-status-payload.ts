import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { getQueueWaitEstimates } from "@/app/(tagging)/queue-estimate";
import { getAcceptedBrandMatches, getAcceptedIpMatches } from "@/lib/feature-decision/match-policy";
import {
  filterFeatureLibraryRecommendations,
  type FeatureLibraryFeatures,
} from "@/lib/feature-library";
import { isAcceptedPersonFace } from "@/lib/person/person-match-policy";
import { getAcceptedProductMatches } from "@/lib/product/product-match-policy";
import type { AssetObject, TaggingQueueItem } from "@/prisma/client";
import prisma from "@/prisma/prisma";

type QueueItem = TaggingQueueItem & { assetObject: AssetObject | null };
type Input = { teamId: number; featureLibraryFeatures: FeatureLibraryFeatures };
const unique = (values: string[]) => [...new Set(values)];
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = index.get(id) ?? [];
    group.push(row);
    index.set(id, group);
  }
  return index;
}

/** Batch estimates and links across the entire request, preserving the single-item response contract. */
export async function buildQueueStatusPayloads({
  teamId,
  queueItems,
  featureLibraryFeatures: features,
}: Input & { queueItems: QueueItem[] }) {
  if (!queueItems.length) return [];
  const ids = queueItems.map((item) => ({
    brand: features.featureBrand
      ? getAcceptedBrandMatches(getBrandRecommendationFromQueueResult(item.result)).map(
          (match) => match.assetLogoId,
        )
      : [],
    ip: features.featureIp
      ? getAcceptedIpMatches(getIpRecommendationFromQueueResult(item.result)).map(
          (match) => match.assetIpId,
        )
      : [],
    product: features.featureProduct
      ? getAcceptedProductMatches(getProductRecommendationFromQueueResult(item.result)).map(
          (match) => match.assetProductId,
        )
      : [],
    person: features.featurePerson
      ? unique(
          getPersonRecommendationFromQueueResult(item.result)?.faces.flatMap((face) =>
            isAcceptedPersonFace(face) && face.bestMatch ? [face.bestMatch.assetPersonId] : [],
          ) ?? [],
        )
      : [],
  }));
  const brands = unique(ids.flatMap((item) => item.brand)),
    ips = unique(ids.flatMap((item) => item.ip));
  const products = unique(ids.flatMap((item) => item.product)),
    persons = unique(ids.flatMap((item) => item.person));
  const tagWhere = { assetTagId: { not: null }, assetTag: { teamId, deletedAt: null } } as const;
  const orderBy = [{ sort: "asc" as const }, { id: "asc" as const }];
  const [estimates, brandRows, ipRows, productRows, personRows] = await Promise.all([
    queueItems.some(item => item.status === "pending" || item.status === "processing") ? getQueueWaitEstimates(teamId, queueItems) : new Map(),
    brands.length
      ? prisma.assetLogoTag.findMany({
          where: { ...tagWhere, assetLogoId: { in: brands }, assetLogo: { teamId } },
          orderBy,
          select: { assetLogoId: true, assetTagId: true, tagPath: true },
        })
      : [],
    ips.length
      ? prisma.assetIpTag.findMany({
          where: { ...tagWhere, assetIpId: { in: ips }, assetIp: { teamId } },
          orderBy,
          select: { assetIpId: true, assetTagId: true, tagPath: true },
        })
      : [],
    products.length
      ? prisma.assetProductTag.findMany({
          where: { ...tagWhere, assetProductId: { in: products }, assetProduct: { teamId } },
          orderBy,
          select: { assetProductId: true, assetTagId: true, tagPath: true },
        })
      : [],
    persons.length
      ? prisma.assetPersonTag.findMany({
          where: { ...tagWhere, assetPersonId: { in: persons }, assetPerson: { teamId } },
          orderBy,
          select: { assetPersonId: true, assetTagId: true, tagPath: true },
        })
      : [],
  ]);
  const brandIndex = groupBy(brandRows, (row) => row.assetLogoId),
    ipIndex = groupBy(ipRows, (row) => row.assetIpId);
  const productIndex = groupBy(productRows, (row) => row.assetProductId),
    personIndex = groupBy(personRows, (row) => row.assetPersonId);
  const path = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  return queueItems.map((item, index) => ({
    ...item,
    queueEstimate: estimates.get(item.id) ?? null,
    result: filterFeatureLibraryRecommendations(item.result, features),
    brandLinkedTags: ids[index].brand
      .flatMap((id) => brandIndex.get(id) ?? [])
      .map((row) => ({ ...row, tagPath: path(row.tagPath) })),
    ipLinkedTags: ids[index].ip
      .flatMap((id) => ipIndex.get(id) ?? [])
      .map((row) => ({ ...row, tagPath: path(row.tagPath) })),
    productLinkedTags: ids[index].product
      .flatMap((id) => productIndex.get(id) ?? [])
      .map((row) => ({ ...row, tagPath: path(row.tagPath) })),
    personLinkedTags: ids[index].person
      .flatMap((id) => personIndex.get(id) ?? [])
      .map((row) => ({ ...row, tagPath: path(row.tagPath) })),
  }));
}

export async function buildQueueStatusPayload({
  queueItem,
  ...input
}: Input & { queueItem: QueueItem }) {
  return (await buildQueueStatusPayloads({ ...input, queueItems: [queueItem] }))[0];
}
