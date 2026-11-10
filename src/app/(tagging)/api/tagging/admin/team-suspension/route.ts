import { getAuthSession } from "@/app/(auth)/requestAuth";
import { CANCELLED_TASK_ERROR_CODE } from "@/app/(tagging)/queue-config";
import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { TEAM_TAGGING_SUSPENDED_KEY } from "@/lib/tagging/team-suspension";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  musedamTeamId: z.string().regex(/^[1-9]\d*$/),
  suspended: z.boolean(),
});

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  const actor = session?.user?.slug;
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(actor)) {
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }
  const { musedamTeamId, suspended } = parsed.data;
  const team = await prisma.team.findUnique({
    where: { slug: `t/${musedamTeamId}` },
    select: { id: true, slug: true, name: true },
  });
  if (!team) {
    return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
  }
  try {
    const cancelledAt = new Date();
    const cancelled = await prisma.$transaction(async (tx) => {
      // Enqueue takes the same row lock. Once committed, no concurrent enqueue
      // can leave a new pending asset task behind this cancellation.
      await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${team.id} FOR UPDATE`;
      await tx.teamConfig.upsert({
        where: { teamId_key: { teamId: team.id, key: TEAM_TAGGING_SUSPENDED_KEY } },
        create: { teamId: team.id, key: TEAM_TAGGING_SUSPENDED_KEY, value: suspended },
        update: { value: suspended },
      });
      if (!suspended) return 0;
      const result = await tx.taggingQueueItem.updateMany({
        where: { teamId: team.id, assetObjectId: { not: null }, status: { in: ["pending", "processing"] } },
        data: {
          status: "failed",
          endsAt: cancelledAt,
          result: {
            error: CANCELLED_TASK_ERROR_CODE,
            message: "团队打标已由管理员暂停",
            cancelledAt: cancelledAt.toISOString(),
            cancelledBy: actor!,
          },
        },
      });
      return result.count;
    });
    rootLogger.warn({ teamId: team.id, teamSlug: team.slug, suspended, cancelled, actor }, "Team tagging suspension updated");
    return NextResponse.json({ success: true, team, suspended, cancelled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    rootLogger.error({ error, teamId: team.id, actor }, "Failed to update team tagging suspension");
    return NextResponse.json({ success: false, error: "Failed to update team tagging suspension" }, { status: 500 });
  }
}
