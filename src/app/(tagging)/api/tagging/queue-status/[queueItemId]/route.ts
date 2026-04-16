import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { withAuth } from "@/app/(auth)/withAuth";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
    queueItemId: z.coerce.number().positive(),
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ queueItemId: string }> }
) {
    return withAuth(async ({ team: { id: teamId } }) => {
        try {
            const resolvedParams = await params;
            const { queueItemId } = paramsSchema.parse(resolvedParams);

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
                    { status: 404 }
                );
            }

            const brandRecommendation = getBrandRecommendationFromQueueResult(queueItem.result);
            const assetLogoId = brandRecommendation?.bestMatch?.assetLogoId;
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

            return NextResponse.json({
                success: true,
                data: {
                    ...queueItem,
                    brandLinkedTags: brandLinkedTags.map((tag) => ({
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
                { status: 500 }
            );
        }
    });
}
