import "server-only";

import {
  filterFeatureLibraryRecommendations,
  type FeatureLibraryFeatures,
} from "@/lib/feature-library";
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
    if (result.productRecommendation?.bestMatch)
      ids.product.add(result.productRecommendation.bestMatch.assetProductId);
    for (const face of result.personRecommendation?.faces ?? []) {
      if (face.bestMatch) ids.person.add(face.bestMatch.assetPersonId);
    }
  }
  const where = (type: ReviewFeatureType) => ({
    teamId,
    enabled: true,
    id: { in: [...ids[type]].filter((id) => UUID_PATTERN.test(id)) },
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
    ids.brand.size
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
    ids.ip.size
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
    ids.product.size
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
    ids.person.size
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
