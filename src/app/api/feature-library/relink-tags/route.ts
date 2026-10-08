import authOptions from "@/app/(auth)/authOptions";
import { checkUserPermission } from "@/app/(auth)/lib";
import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { relinkFeatureTags } from "@/lib/tagging/relink-feature-tags";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z
  .object({
    types: z
      .array(z.enum(["product", "brand", "person", "ip"]))
      .min(1)
      .max(4)
      .default(["product"]),
    dryRun: z.boolean().default(true),
  })
  .strict();

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.team) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(session.user.slug)) {
    return NextResponse.json({ success: false, message: "Forbidden: admin only" }, { status: 403 });
  }
  try {
    await checkUserPermission({ user: session.user, team: session.team });
  } catch {
    return NextResponse.json({ success: false, message: "Permission denied" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 },
    );
  }
  try {
    const data = await relinkFeatureTags(
      session.team.id,
      [...new Set(parsed.data.types)],
      parsed.data.dryRun,
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    rootLogger.error({ msg: "Feature tag relink failed", teamId: session.team.id, error });
    const conflict =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "P2034" ||
        error.code === "P2002" ||
        error.code === "P2003" ||
        error.code === "P2025");
    return NextResponse.json(
      {
        success: false,
        message: conflict
          ? "Tags or features changed concurrently; preview and retry the request"
          : "Failed to relink feature tags",
      },
      { status: conflict ? 409 : 500 },
    );
  }
}
