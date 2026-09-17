// 单租户私有化迁移 —— 在生产应用内直接导出一个团队的数据包。
//
// 鉴权：只允许 admin 账号（环境变量 ADMIN_USER_IDS，逗号分隔，见 src/lib/admin.ts）在已登录状态下访问，其它人一律 403。
//
// 用法：用 admin 账号登录 SaaS 后，在浏览器里直接打开
//   https://<saas-host>/api/tagging/migration/export?musedamTeamId=158258
// 会作为附件下载 team-<id>-export.json。
//
// 返回的 JSON 结构见 src/lib/migration/export-team.ts 的 MigrationBundle，
// 可直接喂给 scripts/migrate-team-import.ts --in-file=team-export.json。
// 图片不随包返回，assets[].sourceUrl 是用本应用的 S3 凭证生成的预签名下载链接（默认 7 天有效）。
//
// 只读：不会修改数据库，也不会往 S3 写。

import authOptions from "@/app/(auth)/authOptions";
import { isAdminUserSlug } from "@/lib/admin";
import { exportTeamBundle, MAX_PRESIGN_SECONDS, musedamTeamIdToSlug } from "@/lib/migration/export-team";
import { signS3ObjectUrl } from "@/lib/s3";
import prisma from "@/prisma/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// 大团队导出可能要跑一会儿
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(session.user.slug)) {
    console.warn(`[migration-export] forbidden: user=${session.user.slug}`);
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const musedamTeamId = params.get("musedamTeamId");
  const teamIdRaw = params.get("teamId");
  if (!musedamTeamId && !teamIdRaw) {
    return NextResponse.json({ success: false, error: "musedamTeamId or teamId is required" }, { status: 400 });
  }

  const presign = params.get("presign") !== "false";
  const presignExpires = Math.min(Number(params.get("presignExpires") || MAX_PRESIGN_SECONDS), MAX_PRESIGN_SECONDS);

  try {
    const where = musedamTeamId ? { teamSlug: musedamTeamIdToSlug(musedamTeamId) } : { teamId: Number(teamIdRaw) };
    const bundle = await exportTeamBundle(prisma, where, {
      presignExpires,
      presign: presign
        ? (objectKey, expiresInSeconds) => {
            const { signedUrl, signedUrlExpiresAt } = signS3ObjectUrl({ objectKey, expiresInSeconds });
            return { url: signedUrl, expiresAt: new Date(signedUrlExpiresAt).toISOString() };
          }
        : undefined,
      log: (msg) => console.log(`[migration-export] [by ${session.user?.slug}] ${msg}`),
    });

    return new NextResponse(JSON.stringify(bundle), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="team-${bundle.manifest.teamId}-export.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[migration-export] failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /不存在/.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
