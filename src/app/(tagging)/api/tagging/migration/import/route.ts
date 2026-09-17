// 单租户私有化迁移 —— 在私有化应用内直接从 URL 拉取数据包并导入。
// 与 scripts/migrate-team-import.ts 共用 src/lib/migration/import-team.ts，
// 目的是不需要运维登堡垒机：管理员在浏览器里打开链接就能完成导入。
//
// 鉴权：只允许 admin 账号（环境变量 ADMIN_USER_IDS，逗号分隔，见 src/lib/admin.ts）在已登录状态下访问，其它人一律 403。
//
// 用法：
//   1. 在 SaaS 用 GET /api/tagging/migration/export 拿到 team-<id>-export.json，上传到我们的 OSS，生成签名下载链接
//   2. 用 admin 登录私有化环境后，在浏览器里依次打开（默认 dryRun=true 只做检查，不写任何东西）：
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=db&dryRun=false
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=resources&dryRun=false[&rewriteFolder=<SaaS 侧 S3_FOLDER>]
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=verify
//      phase=all 三步连跑。全部幂等，超时或部分失败后重复打开同一链接即可续传。
//
// 其它参数：
//   rewriteFolder   SaaS 侧的 S3_FOLDER，和本环境 S3_FOLDER 不一样时必传，脚本会改写 objectKey 前缀
//   sourceUrlBase   导出时没生成签名链接（presign=false）时的 SaaS 图片公网地址前缀
//   concurrency     resources 阶段并发数，默认 8
//
// 客户网络要放行的是 SaaS 桶的公网域名：bundleUrl 和 assets[].sourceUrl 都指向它。

import authOptions from "@/app/(auth)/authOptions";
import { isAdminUserSlug } from "@/lib/admin";
import { assertMigrationBundle, importTeamBundle, isImportPhase, type ImportStorage } from "@/lib/migration/import-team";
import { getS3StorageLocation, headS3Object, uploadS3Object } from "@/lib/s3";
import prisma from "@/prisma/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// 图片多的团队 resources 阶段要跑很久；导入是幂等的，超时后重复打开同一链接会跳过已完成项继续
export const maxDuration = 3600;

const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

async function fetchBundle(bundleUrl: string) {
  let url: URL;
  try {
    url = new URL(bundleUrl);
  } catch {
    throw new Error(`bundleUrl 不合法: ${bundleUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bundleUrl 只支持 http(s)");

  const res = await fetch(url, { cache: "no-store" });
  const shown = `${url.origin}${url.pathname}`; // 日志/报错里不带签名参数
  if (!res.ok) throw new Error(`拉取数据包失败: ${res.status} ${shown}`);
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_BUNDLE_BYTES) throw new Error(`数据包过大: ${length} bytes`);
  const bundle: unknown = await res.json();
  assertMigrationBundle(bundle, shown);
  return bundle;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(session.user.slug)) {
    console.warn(`[migration-import] forbidden: user=${session.user.slug}`);
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const bundleUrl = params.get("bundleUrl");
  if (!bundleUrl) {
    return NextResponse.json({ success: false, error: "bundleUrl is required" }, { status: 400 });
  }
  const phase = params.get("phase") || "all";
  if (!isImportPhase(phase)) {
    return NextResponse.json({ success: false, error: "phase must be db / resources / verify / all" }, { status: 400 });
  }
  // 默认 dry-run，显式 dryRun=false 才真正写库/写桶
  const dryRun = params.get("dryRun") !== "false";
  const rewriteFolder = params.get("rewriteFolder") ?? undefined;
  const sourceUrlBase = params.get("sourceUrlBase") ?? undefined;
  const concurrency = Number(params.get("concurrency") || 8);

  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    console.log(`[migration-import] [by ${session.user?.slug}] ${msg}`);
  };

  try {
    log(`拉取数据包 ${bundleUrl.split("?")[0]}`);
    const bundle = await fetchBundle(bundleUrl);
    log(`已读取 Team #${bundle.manifest.teamId} ${bundle.manifest.teamSlug}，图片 ${bundle.assets.length} 张`);

    let storage: ImportStorage | undefined;
    if (phase === "all" || phase === "resources") {
      const { bucket, folder } = getS3StorageLocation();
      storage = {
        label: "私有化对象存储",
        bucket,
        folder,
        head: headS3Object,
        put: async (objectKey, body, contentType) => {
          await uploadS3Object({ objectKey, body, contentType: contentType || "application/octet-stream" });
        },
      };
    }

    const result = await importTeamBundle(prisma, bundle, {
      phase,
      dryRun,
      storage,
      rewriteFolder,
      sourceUrlBase,
      concurrency,
      log,
    });

    const success = !(result.resources?.failed || (result.verify && !result.verify.ok));
    return NextResponse.json({ success, result, logs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[migration-import] failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message, logs }, { status: 500 });
  }
}
