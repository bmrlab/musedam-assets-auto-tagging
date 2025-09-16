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

            return NextResponse.json({
                success: true,
                data: queueItem,
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
