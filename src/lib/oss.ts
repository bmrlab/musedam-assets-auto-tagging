import "server-only";

import { createHmac, randomUUID } from "crypto";

const DEFAULT_OSS_SIGNED_URL_TTL_SECONDS = 60 * 30;
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 1000;
const signedOssObjectUrlCache = new Map<
  string,
  {
    signedUrl: string;
    signedUrlExpiresAt: number;
  }
>();

type UploadOssObjectOptions = {
  contentType: string;
  objectKey: string;
  body: Buffer;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing OSS config: ${name}`);
  }
  return value;
}

function normalizeOssDomain(domain: string) {
  return domain.endsWith("/") ? domain.slice(0, -1) : domain;
}

function buildObjectUrl(domain: string, objectKey: string) {
  return `${normalizeOssDomain(domain)}/${objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export function buildAssetLogoObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return `auto-tagging/teams-${teamId}-asset-logos-${Date.now()}-${randomUUID()}${safeExtension}`;
}

export function buildAssetIpObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return `auto-tagging/teams-${teamId}-asset-ips-${Date.now()}-${randomUUID()}${safeExtension}`;
}

export function buildAssetProductObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return `auto-tagging/teams-${teamId}-asset-products-${Date.now()}-${randomUUID()}${safeExtension}`;
}

export function buildAssetPersonObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return `auto-tagging/teams-${teamId}-asset-persons-${Date.now()}-${randomUUID()}${safeExtension}`;
}

export function getOssObjectUrl(objectKey: string) {
  return buildObjectUrl(getRequiredEnv("OSS_DOMAIN"), objectKey);
}

/** Public object URL on the CDN origin (uses OSS_CDN_URL, not OSS_DOMAIN). */
export function getCDNUrl(objectKey: string) {
  return buildObjectUrl(getRequiredEnv("OSS_CDN_URL"), objectKey);
}

export function signOssObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_OSS_SIGNED_URL_TTL_SECONDS,
}: {
  objectKey: string;
  expiresInSeconds?: number;
}) {
  const domain = getRequiredEnv("OSS_DOMAIN");
  const bucketName = getRequiredEnv("OSS_BUCKET_NAME");
  const accessKey = getRequiredEnv("OSS_ACCESS_KEY");
  const secretKey = getRequiredEnv("OSS_SECRET_KEY");
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const canonicalResource = `/${bucketName}/${objectKey}`;
  const stringToSign = ["GET", "", "", String(expires), canonicalResource].join("\n");
  const signature = createHmac("sha1", secretKey).update(stringToSign).digest("base64");
  const unsignedUrl = buildObjectUrl(domain, objectKey);
  const signedUrl = new URL(unsignedUrl);

  signedUrl.searchParams.set("OSSAccessKeyId", accessKey);
  signedUrl.searchParams.set("Expires", String(expires));
  signedUrl.searchParams.set("Signature", signature);

  return {
    signedUrl: signedUrl.toString(),
    signedUrlExpiresAt: expires * 1000,
  };
}

export function getCachedSignedOssObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_OSS_SIGNED_URL_TTL_SECONDS,
}: {
  objectKey: string;
  expiresInSeconds?: number;
}) {
  const cacheKey = `${objectKey}:${expiresInSeconds}`;
  const cached = signedOssObjectUrlCache.get(cacheKey);

  if (cached && cached.signedUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
    return cached;
  }

  const nextSignedUrl = signOssObjectUrl({
    objectKey,
    expiresInSeconds,
  });

  signedOssObjectUrlCache.set(cacheKey, nextSignedUrl);
  return nextSignedUrl;
}

export async function uploadOssObject({ body, contentType, objectKey }: UploadOssObjectOptions) {
  const domain = getRequiredEnv("OSS_DOMAIN");
  const bucketName = getRequiredEnv("OSS_BUCKET_NAME");
  const accessKey = getRequiredEnv("OSS_ACCESS_KEY");
  const secretKey = getRequiredEnv("OSS_SECRET_KEY");

  const date = new Date().toUTCString();
  const canonicalResource = `/${bucketName}/${objectKey}`;
  const stringToSign = ["PUT", "", contentType, date, canonicalResource].join("\n");
  const signature = createHmac("sha1", secretKey).update(stringToSign).digest("base64");
  const url = buildObjectUrl(domain, objectKey);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `OSS ${accessKey}:${signature}`,
      "Content-Length": body.byteLength.toString(),
      "Content-Type": contentType,
      Date: date,
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OSS upload failed (${response.status}): ${errorText || "unknown error"}`);
  }

  return {
    objectKey,
  };
}

/**
 * Sets the object ACL to public-read so the object URL is readable without signing.
 * Uses OSS PutObjectACL (PUT ?acl) with the same V1 header signature as uploads.
 */
export async function setOssObjectAclPublicRead({ objectKey }: { objectKey: string }): Promise<void> {
  const domain = getRequiredEnv("OSS_DOMAIN");
  const bucketName = getRequiredEnv("OSS_BUCKET_NAME");
  const accessKey = getRequiredEnv("OSS_ACCESS_KEY");
  const secretKey = getRequiredEnv("OSS_SECRET_KEY");

  const date = new Date().toUTCString();
  const aclValue = "public-read";
  const aclHeader = "x-oss-object-acl";
  const canonicalizedOssHeaders = `${aclHeader}:${aclValue}\n`;
  const canonicalResource = `/${bucketName}/${objectKey}?acl`;
  const stringToSign = `PUT\n\n\n${date}\n${canonicalizedOssHeaders}${canonicalResource}`;
  const signature = createHmac("sha1", secretKey).update(stringToSign).digest("base64");
  const url = `${buildObjectUrl(domain, objectKey)}?acl`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `OSS ${accessKey}:${signature}`,
      Date: date,
      [aclHeader]: aclValue,
      "Content-Length": "0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OSS PutObjectACL failed (${response.status}): ${errorText || "unknown error"}`);
  }
}
