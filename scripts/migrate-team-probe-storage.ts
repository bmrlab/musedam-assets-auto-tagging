// #!/usr/bin/env tsx
//
// 探测一组 S3_* 配置能否写入目标桶：PUT 一个小文件再 HEAD，打印真实错误（含 undici 的 cause）。
// 用法：AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... S3_BUCKET=... S3_ENDPOINT_URL=... S3_REGION=... S3_FORCE_PATH_STYLE=false \
//       npx tsx scripts/migrate-team-probe-storage.ts [--key=<objectKey>] [--oss-native]
// --oss-native：改用阿里云 OSS 原生接口（自动去掉 endpoint 的 "s3." 前缀）

import { loadEnvConfig } from "@next/env";
import { loadS3Config, ossHead, ossNativeEndpoint, ossPut, s3Head, s3Put } from "./lib/migrate-team-shared";

async function main() {
  loadEnvConfig(process.cwd());
  const key = process.argv.find((a) => a.startsWith("--key="))?.slice(6) || "_migration-probe.txt";
  const ossNative = process.argv.includes("--oss-native");
  const cfg = loadS3Config("", "probe");
  console.log(
    `bucket=${cfg.bucket} ${ossNative ? `OSS 原生 ${ossNativeEndpoint(cfg).host}` : `S3 兼容 ${cfg.endpointUrl}`} region=${cfg.region} pathStyle=${cfg.forcePathStyle} key=${key}`,
  );
  try {
    await (ossNative ? ossPut : s3Put)(cfg, key, Buffer.from("ok"), "text/plain");
    console.log("PUT ok");
    console.log("HEAD:", await (ossNative ? ossHead : s3Head)(cfg, key));
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    console.error("FAILED:", e.message);
    if (e.cause) console.error("cause:", e.cause.code ?? "", e.cause.message ?? "");
    process.exit(1);
  }
}

main();
