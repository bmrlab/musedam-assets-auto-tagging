import authOptions from "@/app/(auth)/authOptions";
import { CANCELLED_TASK_ERROR_CODE } from "@/app/(tagging)/queue-config";
import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";
import { TaggingQueueItemResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CancelPendingRequest = {
  musedamTeamId?: string;
  teamSlug?: string;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminUserSlug = session?.user?.slug;
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!adminUserSlug || !isAdminUserSlug(adminUserSlug)) {
    rootLogger.warn(
      { module: "cancel-pending-tasks", user: adminUserSlug },
      "cancel pending tasks forbidden: not admin",
    );
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }

  let body: CancelPendingRequest;
  try {
    body = (await request.json()) as CancelPendingRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const musedamTeamId = body.musedamTeamId?.trim();
  const requestedTeamSlug = body.teamSlug?.trim();
  if (musedamTeamId && !/^\d+$/.test(musedamTeamId)) {
    return NextResponse.json(
      { success: false, error: "musedamTeamId must contain digits only" },
      { status: 400 },
    );
  }
  if (requestedTeamSlug && !/^t\/\d+$/.test(requestedTeamSlug)) {
    return NextResponse.json(
      { success: false, error: "teamSlug must use the t/<MuseDAM team id> format" },
      { status: 400 },
    );
  }

  const teamSlug =
    requestedTeamSlug ||
    (musedamTeamId ? idToSlug("team", new MuseDAMID(musedamTeamId)) : undefined);
  if (!teamSlug) {
    return NextResponse.json(
      { success: false, error: "teamSlug or musedamTeamId is required" },
      { status: 400 },
    );
  }

  try {
    const team = await prisma.team.findUnique({
      where: { slug: teamSlug },
      select: { id: true, slug: true, name: true },
    });
    if (!team) {
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    }

    const cancelledAt = new Date();
    const result = await prisma.taggingQueueItem.updateMany({
      where: {
        teamId: team.id,
        taskType: { not: "test" },
        assetObjectId: { not: null },
        status: "pending",
      },
      data: {
        status: "failed",
        endsAt: cancelledAt,
        result: {
          error: CANCELLED_TASK_ERROR_CODE,
          message: "任务已由管理员批量取消",
          cancelledAt: cancelledAt.toISOString(),
          cancelledBy: adminUserSlug,
        } as TaggingQueueItemResult,
      },
    });

    rootLogger.warn(
      {
        module: "cancel-pending-tasks",
        user: adminUserSlug,
        teamId: team.id,
        teamSlug: team.slug,
        cancelled: result.count,
      },
      "pending tagging tasks cancelled by admin",
    );

    return NextResponse.json(
      {
        success: true,
        team: { slug: team.slug, name: team.name },
        cancelled: result.count,
        cancelledAt: cancelledAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    rootLogger.error(
      { module: "cancel-pending-tasks", user: adminUserSlug, teamSlug, error },
      "failed to cancel pending tagging tasks",
    );
    return NextResponse.json(
      { success: false, error: "Failed to cancel pending tagging tasks" },
      { status: 500 },
    );
  }
}
