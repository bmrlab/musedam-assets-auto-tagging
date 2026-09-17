// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 图片镜像（可选步骤，在我们自己的环境跑）。
//
// 场景：导出包里 assets[].sourceUrl 指向 SaaS 的 AWS 桶，但客户网络只放行了我们某个 OSS 域名。
// 这个脚本把包里的每张图片按 sourceUrl 下载，再以 <prefix>/<objectKey> 上传到那个 OSS 桶，
// 之后客户环境导入时传 sourceUrlBase=<OSS 公网地址>/<prefix>，图片就全部从被放行的域名拉。
//
// 运行位置：我们自己的机器/内网，能访问 SaaS 签名链接 + 持有目标 OSS 的 AK/SK。客户环境不需要动。
//
// 环境变量（目标 OSS，和私有化 App 用的是同一组变量名）：
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET / S3_ENDPOINT_URL / S3_REGION / S3_FORCE_PATH_STYLE
// 用法：
//   npx tsx scripts/migrate-team-mirror-assets.ts --in-file=team-929-export.json --prefix=public/testAssets/team-929
//   npx tsx scripts/migrate-team-mirror-assets.ts --in-url=https://.../team-929-export.json --prefix=public/testAssets/team-929
// 可选：--concurrency=<n>（默认 8）、--dry-run
//
// 幂等：目标 key 已存在就跳过。结束时打印导入接口要用的 sourceUrlBase。
// 注意：<prefix> 下的对象必须能匿名读（和放导出 JSON 的路径一样），否则客户环境拉不到。

import { loadEnvConfig } from "@next/env";
import { assertMigrationBundle, runWithConcurrency } from "@/lib/migration/import-team";
import { buildOutboundFetch } from "@/lib/migration/outbound-fetch";
import { loadS3Config, readJsonFile, s3Head, s3Put } from "./lib/migrate-team-shared";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const has = (name: string) => args.includes(`--${name}`);
  const inFile = get("in-file");
  const inUrl = get("in-url");
  if (!inFile && !inUrl) throw new Error("缺少参数：--in-file=<bundle.json> 或 --in-url=<链接>");
  if (inFile && inUrl) throw new Error("--in-file 和 --in-url 只能二选一");
  const prefix = (get("prefix") || "").replace(/^\/+|\/+$/g, "");
  if (!prefix) throw new Error("缺少参数：--prefix=<OSS 上的目录前缀>");
  return { inFile, inUrl, prefix, dryRun: has("dry-run"), concurrency: Number(get("concurrency") || "8") };
}

const outbound = buildOutboundFetch();

async function fetchBuffer(url: string) {
  const res = await outbound.fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseArgs();

  const from = args.inFile ?? args.inUrl!.split("?")[0];
  const bundle: unknown = args.inFile
    ? await readJsonFile(args.inFile)
    : await (async () => {
        const res = await outbound.fetch(args.inUrl!);
        if (!res.ok) throw new Error(`拉取 bundle 失败: ${res.status} ${from}`);
        return res.json();
      })();
  assertMigrationBundle(bundle, from);

  const assets = bundle.assets;
  const missing = assets.filter((a) => !a.sourceUrl).length;
  if (missing > 0) throw new Error(`包里有 ${missing} 条没有 sourceUrl，无法镜像（导出时不要加 --skip-presign）`);
  const expiresAt = bundle.manifest.signedUrlExpiresAt;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) throw new Error(`签名链接已于 ${expiresAt} 过期，请重新导出`);

  const target = loadS3Config("", "镜像 OSS");
  console.log(`Team #${bundle.manifest.teamId} ${bundle.manifest.teamSlug}，图片 ${assets.length} 张`);
  console.log(`目标: bucket=${target.bucket} endpoint=${target.endpointUrl} prefix=${args.prefix}，并发 ${args.concurrency}`);

  let done = 0;
  let skipped = 0;
  const failures: string[] = [];
  await runWithConcurrency(assets, args.concurrency, async (a) => {
    const key = `${args.prefix}/${a.objectKey.replace(/^\/+/, "")}`;
    try {
      if (args.dryRun) return;
      if (await s3Head(target, key)) {
        skipped += 1;
        return;
      }
      const body = await fetchBuffer(a.sourceUrl!);
      await s3Put(target, key, body, a.mimeType);
    } catch (err) {
      failures.push(`${a.objectKey}: ${(err as Error).message}`);
    } finally {
      done += 1;
      if (done % 50 === 0 || done === assets.length) {
        console.log(`  ${done}/${assets.length}，已存在跳过 ${skipped}，失败 ${failures.length}`);
      }
    }
  });

  if (failures.length > 0) {
    console.error(`\n⚠️ ${failures.length} 张失败（重跑即可重试）：`);
    for (const f of failures.slice(0, 50)) console.error(`  - ${f}`);
    process.exitCode = 2;
  }

  // 公网地址：virtual-hosted 风格 https://<bucket>.<endpoint host>/<prefix>
  const endpoint = new URL(target.endpointUrl);
  const publicHost = target.forcePathStyle ? `${endpoint.host}/${target.bucket}` : `${target.bucket}.${endpoint.host}`;
  console.log(`\n${args.dryRun ? "[dry-run] " : ""}镜像完成。客户环境导入 resources 阶段时加参数：`);
  console.log(`  sourceUrlBase=${endpoint.protocol}//${publicHost}/${args.prefix}`);
  console.log("（S3_ENDPOINT_URL 若是 s3.oss-xxx 这种 S3 兼容域名，请把上面的 host 换成 OSS 原生公网域名，例如 <bucket>.oss-cn-beijing.aliyuncs.com）");
}

main().catch((err) => {
  console.error("❌ 镜像失败:", err);
  process.exit(1);
});
