// #!/usr/bin/env tsx
//
// 单租户私有化部署数据迁移 —— 图片镜像（可选步骤，在我们自己的环境跑）。
//
// 两种用法：
//
// A. 中转：客户 Pod 出网只放行了我们某个 OSS 域名。把图片按 <prefix>/<objectKey> 传到那个桶，
//    客户环境导入 resources 时传 sourceUrlBase=<OSS 公网地址>/<prefix>，图片从被放行的域名拉。
//      npx tsx scripts/migrate-team-mirror-assets.ts --in-url=<JSON 链接> --prefix=public/testAssets/team-929
//    <prefix> 下的对象必须能匿名读，否则客户环境拉不到。
//
// B. 直传客户桶：客户 Pod 连不上自己桶的 S3 兼容域名（s3.oss-cn-xxx），但公网能连。用客户桶的 AK/SK
//    从我们这边直接把图片传到客户桶的原路径（不加前缀，key = objectKey），resources 阶段就不需要在 Pod 里跑了：
//      npx tsx scripts/migrate-team-mirror-assets.ts --in-url=<JSON 链接> --direct
//    前提是导入时不改写 objectKey（不传 rewriteFolder），且图片 source 字段应用里没用到，可以不更新数据库。
//    传完在客户环境直接触发 phase=verify 即可。
//
// 运行位置：我们自己的机器，能访问 SaaS 签名链接 + 持有目标桶的 AK/SK。客户环境不需要动。
//
// 环境变量（目标桶，和私有化 App 用的是同一组变量名）：
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET / S3_ENDPOINT_URL / S3_REGION / S3_FORCE_PATH_STYLE
// 可选：--concurrency=<n>（默认 8）、--dry-run
//       --oss-native  用阿里云 OSS 原生接口上传（S3 兼容 endpoint 返回 403 时用），环境变量不用改，
//                     脚本自动把 S3_ENDPOINT_URL 里的 "s3." 去掉
//
// 幂等：目标 key 已存在就跳过。每张图网络出错自动重试 3 次（间隔 2s/4s/8s），跑完仍失败的重跑同一命令即可补上。

import { loadEnvConfig } from "@next/env";
import { assertMigrationBundle, runWithConcurrency } from "@/lib/migration/import-team";
import { buildOutboundFetch } from "@/lib/migration/outbound-fetch";
import { loadS3Config, ossHead, ossNativeEndpoint, ossPut, readJsonFile, s3Head, s3Put } from "./lib/migrate-team-shared";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const has = (name: string) => args.includes(`--${name}`);
  const inFile = get("in-file");
  const inUrl = get("in-url");
  if (!inFile && !inUrl) throw new Error("缺少参数：--in-file=<bundle.json> 或 --in-url=<链接>");
  if (inFile && inUrl) throw new Error("--in-file 和 --in-url 只能二选一");
  const prefix = (get("prefix") || "").replace(/^\/+|\/+$/g, "");
  const direct = has("direct");
  if (!prefix && !direct) throw new Error("缺少参数：--prefix=<目录前缀>（中转）或 --direct（直传客户桶原路径）");
  if (prefix && direct) throw new Error("--prefix 和 --direct 只能二选一");
  return {
    inFile,
    inUrl,
    prefix,
    direct,
    ossNative: has("oss-native"),
    dryRun: has("dry-run"),
    concurrency: Number(get("concurrency") || "8"),
  };
}

const outbound = buildOutboundFetch();

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      // 源图 404 重试没意义
      if (/404/.test((err as Error).message)) throw err;
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

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
  const head = args.ossNative ? ossHead : s3Head;
  const put = args.ossNative ? ossPut : s3Put;
  console.log(`Team #${bundle.manifest.teamId} ${bundle.manifest.teamSlug}，图片 ${assets.length} 张`);
  console.log(
    `目标: bucket=${target.bucket} ${args.ossNative ? `OSS 原生接口 ${ossNativeEndpoint(target).host}` : `S3 兼容接口 ${target.endpointUrl}`} ` +
      `${args.direct ? "直传原路径（key = objectKey）" : `prefix=${args.prefix}`}，并发 ${args.concurrency}`,
  );

  let done = 0;
  let skipped = 0;
  const failures: string[] = [];
  await runWithConcurrency(assets, args.concurrency, async (a) => {
    const bare = a.objectKey.replace(/^\/+/, "");
    const key = args.direct ? bare : `${args.prefix}/${bare}`;
    try {
      if (args.dryRun) return;
      if (await withRetry(() => head(target, key))) {
        skipped += 1;
        return;
      }
      await withRetry(async () => {
        const body = await fetchBuffer(a.sourceUrl!);
        await put(target, key, body, a.mimeType);
      });
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

  if (args.direct) {
    console.log(`\n${args.dryRun ? "[dry-run] " : ""}直传完成。客户环境不需要跑 resources 阶段，直接触发 phase=verify 核对行数即可。`);
    return;
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
