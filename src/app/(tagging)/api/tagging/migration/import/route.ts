// 单租户私有化迁移 —— 在私有化应用内从 URL 拉取数据包并导入（后台任务）。
// 与 scripts/migrate-team-import.ts 共用 src/lib/migration/import-team.ts，任务管理见 import-job.ts。
// 目的是不需要运维登堡垒机：管理员在浏览器里打开链接就能完成导入。
//
// 鉴权：只允许 admin 账号（环境变量 ADMIN_USER_IDS，逗号分隔，见 src/lib/admin.ts）在已登录状态下访问，其它人一律 403。
//
// 用法：
//   1. 在 SaaS 用 GET /api/tagging/migration/export 拿到 team-<id>-export.json，上传到我们的 OSS，生成签名下载链接
//   2. 用 admin 登录私有化环境后，在浏览器里依次触发（默认 dryRun=true 只做检查，不写任何东西）：
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=db&dryRun=false
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=resources&dryRun=false[&rewriteFolder=<SaaS 侧 S3_FOLDER>]
//        /api/tagging/migration/import?bundleUrl=<链接>&phase=verify
//      触发后立即返回任务 id（HTTP 202），导入在后台跑。同一时间只允许一个任务，重复触发返回 409 和当前进度。
//   3. 随时打开 /api/tagging/migration/import?action=status 看进度、失败项和最近日志；
//      /api/tagging/migration/import?action=cancel 在当前批次后停止。
//      每个阶段等 status 里 status=done 再触发下一个。全部幂等，失败后重新触发同一阶段即可续传。
//
// 其它参数：
//   rewriteFolder   SaaS 侧的 S3_FOLDER，和本环境 S3_FOLDER 不一样时必传，脚本会改写 objectKey 前缀
//   sourceUrlBase   导出时没生成签名链接（presign=false）时的 SaaS 图片公网地址前缀
//   concurrency     resources 阶段并发数，默认 8
//   batchSize       db 阶段每个事务写多少行，默认 200
//
// 客户网络要放行的是 SaaS 桶的公网域名：bundleUrl 和 assets[].sourceUrl 都指向它。

import authOptions from "@/app/(auth)/authOptions";
import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { cancelImportJob, getImportJob, startImportJob } from "@/lib/migration/import-job";
import { isImportPhase } from "@/lib/migration/import-team";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminUserSlug(session.user.slug)) {
    rootLogger.warn({ module: "migration-import", user: session.user.slug }, "import forbidden: not admin");
    return NextResponse.json({ success: false, error: "Forbidden: admin only" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const action = params.get("action") || "start";

  if (action === "status") {
    const job = getImportJob();
    return NextResponse.json({ success: true, job }, noStore);
  }
  if (action === "cancel") {
    const job = cancelImportJob();
    return NextResponse.json({ success: true, job }, noStore);
  }
  if (action !== "start") {
    return NextResponse.json({ success: false, error: "action must be start / status / cancel" }, { status: 400 });
  }

  const bundleUrl = params.get("bundleUrl");
  if (!bundleUrl) {
    return NextResponse.json({ success: false, error: "bundleUrl is required" }, { status: 400 });
  }
  const phase = params.get("phase") || "all";
  if (!isImportPhase(phase)) {
    return NextResponse.json({ success: false, error: "phase must be db / resources / verify / all" }, { status: 400 });
  }

  const { started, job } = startImportJob({
    bundleUrl,
    phase,
    // 默认 dry-run，显式 dryRun=false 才真正写库/写桶
    dryRun: params.get("dryRun") !== "false",
    rewriteFolder: params.get("rewriteFolder") ?? undefined,
    sourceUrlBase: params.get("sourceUrlBase") ?? undefined,
    concurrency: Number(params.get("concurrency") || 8),
    batchSize: Number(params.get("batchSize") || 200),
    startedBy: session.user.slug,
  });

  if (!started) {
    return NextResponse.json(
      { success: false, error: "已有导入任务在运行，请等它结束（?action=status 查看进度，?action=cancel 取消）", job },
      { status: 409, ...noStore },
    );
  }
  return NextResponse.json(
    { success: true, message: "任务已在后台启动，打开 ?action=status 查看进度", job },
    { status: 202, ...noStore },
  );
}
