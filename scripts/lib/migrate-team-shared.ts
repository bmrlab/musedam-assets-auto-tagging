// 私有化数据迁移脚本共享工具：S3/OSS 签名请求 + 并发池 + 文件读写。
// 被 scripts/migrate-team-export.ts（在能连 SaaS AWS 的环境跑）
// 和 scripts/migrate-team-import.ts（在客户堡垒机里跑，只连目标阿里云）共用。

import { createHash, createHmac } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

export type S3Config = {
  label: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpointUrl: string;
  region: string;
  forcePathStyle: boolean;
  folder: string;
};

export function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量: ${name}`);
  return v;
}

export function boolEnv(name: string, fallback: boolean) {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

function normalizeFolder(folder: string | undefined) {
  return (folder || "").replace(/^\/+|\/+$/g, "");
}

// prefix 为空字符串时读取 AWS_ACCESS_KEY_ID / S3_BUCKET / ...
// prefix 为 "SOURCE_" 时读取 SOURCE_AWS_ACCESS_KEY_ID / SOURCE_S3_BUCKET / ...
export function loadS3Config(prefix: string, label: string): S3Config {
  const env = (name: string) => `${prefix}${name}`;
  return {
    label,
    accessKeyId: requiredEnv(env("AWS_ACCESS_KEY_ID")),
    secretAccessKey: requiredEnv(env("AWS_SECRET_ACCESS_KEY")),
    bucket: requiredEnv(env("S3_BUCKET")),
    endpointUrl: requiredEnv(env("S3_ENDPOINT_URL")),
    region: requiredEnv(env("S3_REGION")),
    forcePathStyle: boolEnv(env("S3_FORCE_PATH_STYLE"), true),
    folder: normalizeFolder(process.env[env("S3_FOLDER")]),
  };
}

function sha256Hex(v: string | Buffer | Uint8Array) {
  return createHash("sha256").update(v).digest("hex");
}
function hmac(key: Buffer | string, v: string) {
  return createHmac("sha256", key).update(v).digest();
}
function signingKey(secret: string, dateStamp: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"), "aws4_request");
}
function amzDate(d = new Date()) {
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz, dateStamp: amz.slice(0, 8) };
}

function buildObjectUrl(cfg: S3Config, objectKey: string) {
  const endpoint = new URL(cfg.endpointUrl.endsWith("/") ? cfg.endpointUrl : `${cfg.endpointUrl}/`);
  const keyPath = objectKey.split("/").map(encodeURIComponent).join("/");
  if (!cfg.forcePathStyle) {
    endpoint.host = `${cfg.bucket}.${endpoint.host}`;
    endpoint.pathname = `/${keyPath}`;
    return endpoint;
  }
  const basePath = endpoint.pathname.replace(/\/+$/g, "");
  endpoint.pathname = `${basePath}/${[encodeURIComponent(cfg.bucket), keyPath].join("/")}`;
  return endpoint;
}

function signRequest(
  cfg: S3Config,
  method: string,
  url: URL,
  payloadHash: string,
  extraHeaders: Record<string, string> = {},
) {
  const { amz, dateStamp } = amzDate();
  const headers: Record<string, string> = {
    ...extraHeaders,
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  const normalized = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = normalized.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = normalized.map(([k]) => k).join(";");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign).toString("hex");
  const fetchHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => k !== "host"));
  return {
    ...fetchHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", "),
  };
}

function encodeRfc3986(v: string) {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// SigV4 预签名 GET 链接（query string 签名），最长 7 天（604800 秒，AWS 上限）。
// 用于导出阶段：在能拿到 SaaS 凭证的环境里给每张图片生成可直接下载的临时链接，
// 客户环境导入时只需要访问这个链接，不需要我们的 AK/SK。
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

export function presignGetUrl(cfg: S3Config, objectKey: string, expiresInSeconds = MAX_PRESIGN_SECONDS) {
  const url = buildObjectUrl(cfg, objectKey);
  const { amz, dateStamp } = amzDate();
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${cfg.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amz],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join(
    "\n",
  );
  const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp, cfg.region), stringToSign).toString("hex");
  for (const [k, v] of query) url.searchParams.set(k, v);
  url.searchParams.set("X-Amz-Signature", signature);
  return {
    url: url.toString(),
    expiresAt: new Date((Math.floor(Date.now() / 1000) + expiresInSeconds) * 1000).toISOString(),
  };
}

export async function s3Head(cfg: S3Config, objectKey: string) {
  const url = buildObjectUrl(cfg, objectKey);
  const headers = signRequest(cfg, "HEAD", url, "UNSIGNED-PAYLOAD");
  const res = await fetch(url, { method: "HEAD", headers });
  return res.ok;
}

export async function s3Put(cfg: S3Config, objectKey: string, body: Buffer, contentType: string) {
  const url = buildObjectUrl(cfg, objectKey);
  const payloadHash = sha256Hex(body);
  const headers = signRequest(cfg, "PUT", url, payloadHash, {
    "Content-Type": contentType || "application/octet-stream",
    "x-amz-acl": "public-read",
  });
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  if (!res.ok) {
    throw new Error(`[${cfg.label}] PUT ${objectKey} 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

// ---------------------------------------------------------------------------
// 阿里云 OSS 原生接口（不是 S3 兼容接口）。用于客户桶的 AK 没有 S3 兼容访问权限（S3 兼容 endpoint 返回 403）时。
// 复用同一组 S3_* 环境变量：endpoint 去掉 "s3." 前缀就是 OSS 原生 endpoint，请求域名为 <bucket>.<endpoint>。
// 签名用 OSS 的 V1 头签名：Authorization: OSS <AK>:base64(hmac-sha1(SK, stringToSign))
//   stringToSign = VERB\nContent-MD5\nContent-Type\nDate\n<CanonicalizedOSSHeaders><CanonicalizedResource>
// ---------------------------------------------------------------------------

export function ossNativeEndpoint(cfg: S3Config) {
  const u = new URL(cfg.endpointUrl.endsWith("/") ? cfg.endpointUrl : `${cfg.endpointUrl}/`);
  u.host = u.host.replace(/^s3\./, "");
  return u;
}

function ossObjectUrl(cfg: S3Config, objectKey: string) {
  const u = ossNativeEndpoint(cfg);
  u.host = `${cfg.bucket}.${u.host}`;
  u.pathname = `/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  return u;
}

function ossSign(cfg: S3Config, method: string, objectKey: string, contentType: string, ossHeaders: Record<string, string>) {
  const date = new Date().toUTCString();
  const canonicalHeaders = Object.entries(ossHeaders)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}\n`)
    .join("");
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalHeaders}/${cfg.bucket}/${objectKey}`;
  const signature = createHmac("sha1", cfg.secretAccessKey).update(stringToSign, "utf8").digest("base64");
  return {
    ...ossHeaders,
    Date: date,
    ...(contentType ? { "Content-Type": contentType } : {}),
    Authorization: `OSS ${cfg.accessKeyId}:${signature}`,
  };
}

export async function ossHead(cfg: S3Config, objectKey: string) {
  const url = ossObjectUrl(cfg, objectKey);
  const res = await fetch(url, { method: "HEAD", headers: ossSign(cfg, "HEAD", objectKey, "", {}) });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`[${cfg.label}] OSS HEAD ${objectKey} 失败: ${res.status} ${res.headers.get("x-oss-request-id") ?? ""}`);
  return true;
}

export async function ossPut(cfg: S3Config, objectKey: string, body: Buffer, contentType: string) {
  const url = ossObjectUrl(cfg, objectKey);
  const ct = contentType || "application/octet-stream";
  const headers = ossSign(cfg, "PUT", objectKey, ct, { "x-oss-object-acl": "public-read" });
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  if (!res.ok) {
    throw new Error(`[${cfg.label}] OSS PUT ${objectKey} 失败: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
}

export async function writeJsonFile(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"));
}
