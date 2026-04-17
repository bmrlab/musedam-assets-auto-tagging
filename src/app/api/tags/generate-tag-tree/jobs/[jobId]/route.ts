import { withAuth } from "@/app/(auth)/withAuth";
import { isTagTreeJob } from "@/app/tags/tagTreeQueue";
import { TagTreeGenerationJobResult } from "@/prisma/client";
import { rootLogger } from "@/lib/logging";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const paramsSchema = z.object({
  jobId: z.coerce.number().positive(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  return withAuth(async ({ team }) => {
    const resolvedParams = await params;
    const parsed = paramsSchema.safeParse(resolvedParams);
    if (!parsed.success) {
      return NextResponse.json({ success: false, message: "Invalid jobId" } as const, { status: 400 });
    }

    const { jobId } = parsed.data;

    const item = await prisma.taggingQueueItem.findFirst({
      where: { id: jobId, teamId: team.id },
    });

    if (!item || !isTagTreeJob(item)) {
      return NextResponse.json({ success: false, message: "Job not found" } as const, { status: 404 });
    }

    const result = item.result as TagTreeGenerationJobResult;

    rootLogger.info({
      msg: "tag-tree job api polled",
      jobId: item.id,
      teamId: team.id,
      status: item.status,
    });

    return NextResponse.json({
      success: true,
      data: {
        jobId: item.id,
        status: item.status,
        result: item.status === "completed" || item.status === "failed" ? result : undefined,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    });
  });
}
