import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { restoreDeletedAssets } from "@/lib/tagging/restore-deleted-assets";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    musedamTeamId: z.string().regex(/^[1-9]\d*$/),
    dryRun: z.boolean().default(true),
    acknowledgeStatusReset: z.boolean().default(false),
    afterId: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(50).default(20),
    assetIds: z
      .array(z.string().regex(/^[1-9]\d*$/))
      .min(1)
      .max(50)
      .optional(),
  })
  .strict()
  .refine((body) => body.dryRun || body.acknowledgeStatusReset, {
    message:
      "Restoration requires acknowledgeStatusReset: true; historical rejected items will return to pending",
  });

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(session.user.slug)) {
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") },
      { status: 400 },
    );
  }
  try {
    const data = await restoreDeletedAssets(parsed.data);
    if (!data)
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    rootLogger.info(
      { module: "restore-deleted-assets", user: session.user.slug, ...data },
      "Deleted review asset restoration",
    );
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    rootLogger.error(
      { module: "restore-deleted-assets", teamId: parsed.data.musedamTeamId, error },
      "Failed to restore deleted review assets",
    );
    return NextResponse.json(
      { success: false, error: "Restoration failed; retry this batch" },
      { status: 500 },
    );
  }
}
