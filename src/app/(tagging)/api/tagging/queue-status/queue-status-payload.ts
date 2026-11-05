import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { getQueueWaitEstimate } from "@/app/(tagging)/queue-estimate";
import { getAcceptedBrandMatches, getAcceptedIpMatches } from "@/lib/feature-decision/match-policy";
import {
  filterFeatureLibraryRecommendations,
  type FeatureLibraryFeatures,
} from "@/lib/feature-library";
import { isAcceptedPersonFace } from "@/lib/person/person-match-policy";
import { getAcceptedProductMatches } from "@/lib/product/product-match-policy";
import type { AssetObject, TaggingQueueItem } from "@/prisma/client";
import prisma from "@/prisma/prisma";

/** 单条 / 批量 queue-status 接口共用：组装一个队列项的状态、排队预估与特征关联标签。 */
export async function buildQueueStatusPayload({
  teamId,
  queueItem,
  featureLibraryFeatures,
}: {
  teamId: number;
  queueItem: TaggingQueueItem & { assetObject: AssetObject | null };
  featureLibraryFeatures: FeatureLibraryFeatures;
}) {
  // 排队 / 处理中的任务：附带排队位置与预估等待时长，供测试页展示"还要等多久"
  const queueEstimate =
    queueItem.status === "pending" || queueItem.status === "processing"
      ? await getQueueWaitEstimate({
          teamId,
          queueItemId: queueItem.id,
          createdAt: queueItem.createdAt,
          status: queueItem.status,
          taskType: queueItem.taskType,
        })
      : null;

  const brandRecommendation = featureLibraryFeatures.featureBrand
    ? getBrandRecommendationFromQueueResult(queueItem.result)
    : null;
  const assetLogoIds = getAcceptedBrandMatches(brandRecommendation).map(
    (match) => match.assetLogoId,
  );
  const ipRecommendation = featureLibraryFeatures.featureIp
    ? getIpRecommendationFromQueueResult(queueItem.result)
    : null;
  const assetIpIds = getAcceptedIpMatches(ipRecommendation).map((match) => match.assetIpId);
  const productRecommendation = featureLibraryFeatures.featureProduct
    ? getProductRecommendationFromQueueResult(queueItem.result)
    : null;
  const assetProductIds = getAcceptedProductMatches(productRecommendation).map(
    (match) => match.assetProductId,
  );
  const personRecommendation = featureLibraryFeatures.featurePerson
    ? getPersonRecommendationFromQueueResult(queueItem.result)
    : null;
  const assetPersonIds = Array.from(
    new Set(
      personRecommendation?.faces
        .map((face) =>
          isAcceptedPersonFace(face) && face.bestMatch ? face.bestMatch.assetPersonId : null,
        )
        .filter((id): id is string => Boolean(id)) ?? [],
    ),
  );
  const brandLinkedTags =
    assetLogoIds.length > 0
      ? await prisma.assetLogoTag.findMany({
          where: {
            assetLogoId: { in: assetLogoIds },
            assetTagId: {
              not: null,
            },
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
          select: {
            assetLogoId: true,
            assetTagId: true,
            tagPath: true,
          },
        })
      : [];
  const ipLinkedTags =
    assetIpIds.length > 0
      ? await prisma.assetIpTag.findMany({
          where: {
            assetIpId: { in: assetIpIds },
            assetTagId: {
              not: null,
            },
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
          select: {
            assetIpId: true,
            assetTagId: true,
            tagPath: true,
          },
        })
      : [];
  const productLinkedTags =
    assetProductIds.length > 0
      ? await prisma.assetProductTag.findMany({
          where: {
            assetProductId: { in: assetProductIds },
            assetTagId: {
              not: null,
            },
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
          select: {
            assetProductId: true,
            assetTagId: true,
            tagPath: true,
          },
        })
      : [];
  const personLinkedTags =
    assetPersonIds.length > 0
      ? await prisma.assetPersonTag.findMany({
          where: {
            assetPersonId: {
              in: assetPersonIds,
            },
            assetTagId: {
              not: null,
            },
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
          select: {
            assetPersonId: true,
            assetTagId: true,
            tagPath: true,
          },
        })
      : [];

  return {
    ...queueItem,
    queueEstimate,
    result: filterFeatureLibraryRecommendations(queueItem.result, featureLibraryFeatures),
    brandLinkedTags: brandLinkedTags.map((tag) => ({
      assetLogoId: tag.assetLogoId,
      assetTagId: tag.assetTagId,
      tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
    })),
    ipLinkedTags: ipLinkedTags.map((tag) => ({
      assetIpId: tag.assetIpId,
      assetTagId: tag.assetTagId,
      tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
    })),
    productLinkedTags: productLinkedTags.map((tag) => ({
      assetProductId: tag.assetProductId,
      assetTagId: tag.assetTagId,
      tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
    })),
    personLinkedTags: personLinkedTags.map((tag) => ({
      assetPersonId: tag.assetPersonId,
      assetTagId: tag.assetTagId,
      tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
    })),
  };
}
