import { withAuth } from "@/app/(auth)/withAuth";
import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { stripFeatureLibraryRecommendations } from "@/lib/feature-library";
import { getFeatureLibraryEnabledFromRequest } from "@/lib/feature-library-server";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  queueItemId: z.coerce.number().positive(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ queueItemId: string }> },
) {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const resolvedParams = await params;
      const { queueItemId } = paramsSchema.parse(resolvedParams);
      const featureClassify = getFeatureLibraryEnabledFromRequest(request);

      const queueItem = await prisma.taggingQueueItem.findFirst({
        where: {
          id: queueItemId,
          teamId,
        },
        include: {
          assetObject: true,
        },
      });
      if (!queueItem) {
        return NextResponse.json(
          {
            success: false,
            error: "Queue item not found",
          },
          { status: 404 },
        );
      }

      const brandRecommendation = featureClassify
        ? getBrandRecommendationFromQueueResult(queueItem.result)
        : null;
      const assetLogoId = brandRecommendation?.bestMatch?.assetLogoId;
      const ipRecommendation = featureClassify
        ? getIpRecommendationFromQueueResult(queueItem.result)
        : null;
      const assetIpId = ipRecommendation?.bestMatch?.assetIpId;
      const productRecommendation = featureClassify
        ? getProductRecommendationFromQueueResult(queueItem.result)
        : null;
      const assetProductId = productRecommendation?.bestMatch?.assetProductId;
      const personRecommendation = featureClassify
        ? getPersonRecommendationFromQueueResult(queueItem.result)
        : null;
      const assetPersonIds = Array.from(
        new Set(
          personRecommendation?.faces
            .map((face) =>
              !face.noConfidentMatch && face.bestMatch ? face.bestMatch.assetPersonId : null,
            )
            .filter((id): id is string => Boolean(id)) ?? [],
        ),
      );
      const brandLinkedTags = assetLogoId
        ? await prisma.assetLogoTag.findMany({
            where: {
              assetLogoId,
              assetTagId: {
                not: null,
              },
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              assetTagId: true,
              tagPath: true,
            },
          })
        : [];
      const ipLinkedTags = assetIpId
        ? await prisma.assetIpTag.findMany({
            where: {
              assetIpId,
              assetTagId: {
                not: null,
              },
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              assetTagId: true,
              tagPath: true,
            },
          })
        : [];
      const productLinkedTags = assetProductId
        ? await prisma.assetProductTag.findMany({
            where: {
              assetProductId,
              assetTagId: {
                not: null,
              },
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
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

      return NextResponse.json({
        success: true,
        data: {
          ...queueItem,
          result: featureClassify
            ? queueItem.result
            : stripFeatureLibraryRecommendations(queueItem.result),
          brandLinkedTags: brandLinkedTags.map((tag) => ({
            assetTagId: tag.assetTagId,
            tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          })),
          ipLinkedTags: ipLinkedTags.map((tag) => ({
            assetTagId: tag.assetTagId,
            tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          })),
          productLinkedTags: productLinkedTags.map((tag) => ({
            assetTagId: tag.assetTagId,
            tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          })),
          personLinkedTags: personLinkedTags.map((tag) => ({
            assetPersonId: tag.assetPersonId,
            assetTagId: tag.assetTagId,
            tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          })),
        },
      });
    } catch (error) {
      console.error("获取队列状态失败:", error);
      return NextResponse.json(
        {
          success: false,
          error: "获取队列状态失败",
        },
        { status: 500 },
      );
    }
  });
}
