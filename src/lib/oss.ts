import "server-only";

import { createHmac, randomUUID } from "crypto";

import type { OssObjectIdentity, OssObjectLocation } from "./oss-types";
import {
  getCurrentOssUploadToken,
  getOssLocationFromUploadToken,
  getUploadTokenBoundedExpiresInSeconds,
  type OssUploadToken,
} from "./oss-upload-token";

export const FEATURE_LIBRARY_OBJECT_KEY_PREFIX = "feature-library";

const DEFAULT_OSS_SIGNED_URL_TTL_SECONDS = 60 * 30;
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 1000;
const signedOssObjectUrlCache = new Map<
  string,
  {
    signedUrl: string;
    signedUrlExpiresAt: number;
  }
>();

type UploadOssObjectOptions = OssObjectIdentity & {
  contentType: string;
  body: Buffer;
  token: OssUploadToken;
};

type SignOssObjectUploadUrlOptions = OssObjectIdentity & {
  contentType: string;
  token: OssUploadToken;
  expiresInSeconds?: number;
};

function normalizeOssEndpoint(endpoint: string) {
  const normalizedEndpoint = endpoint.trim().endsWith("/")
    ? endpoint.trim().slice(0, -1)
    : endpoint.trim();
  return normalizedEndpoint.replace(/^http:\/\//i, "https://");
}

function buildBucketDomain(location: OssObjectLocation) {
  const endpointUrl = new URL(normalizeOssEndpoint(location.ossEndpoint));

  if (!endpointUrl.hostname.startsWith(`${location.ossBucket}.`)) {
    endpointUrl.hostname = `${location.ossBucket}.${endpointUrl.hostname}`;
  }

  endpointUrl.pathname = "";
  endpointUrl.search = "";
  endpointUrl.hash = "";

  return endpointUrl.toString().replace(/\/$/, "");
}

function buildObjectUrl(location: OssObjectLocation, objectKey: string) {
  return `${buildBucketDomain(location)}/${objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function createSafeExtension(extension: string) {
  return extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
}

function normalizeObjectKeyPrefix(prefix: string) {
  return prefix
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function buildAssetObjectKey({ category, extension }: { category: string; extension: string }) {
  const safePrefix = normalizeObjectKeyPrefix(FEATURE_LIBRARY_OBJECT_KEY_PREFIX);

  if (!safePrefix) {
    throw new Error("Missing OSS object key prefix.");
  }

  return `${safePrefix}/${category}/${Date.now()}-${randomUUID()}${createSafeExtension(extension)}`;
}

export function buildAssetLogoObjectKey({ extension }: { extension: string }) {
  return buildAssetObjectKey({ category: "asset-logos", extension });
}

export function buildAssetIpObjectKey({ extension }: { extension: string }) {
  return buildAssetObjectKey({ category: "asset-ips", extension });
}

export function buildAssetProductObjectKey({ extension }: { extension: string }) {
  return buildAssetObjectKey({ category: "asset-products", extension });
}

export function buildAssetPersonObjectKey({ extension }: { extension: string }) {
  return buildAssetObjectKey({ category: "asset-persons", extension });
}

export function assertObjectKeyMatchesUploadToken(objectKey: string) {
  const prefix = normalizeObjectKeyPrefix(FEATURE_LIBRARY_OBJECT_KEY_PREFIX);

  if (!prefix || !objectKey.startsWith(`${prefix}/`)) {
    throw new Error("OSS object key does not match the feature library prefix.");
  }
}

export function getOssObjectUrl(identity: OssObjectIdentity) {
  return buildObjectUrl(identity, identity.objectKey);
}

function buildCanonicalizedOssHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase().trim(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");
}

function buildCanonicalResource({
  objectKey,
  ossBucket,
  subresources,
}: Pick<OssObjectIdentity, "objectKey" | "ossBucket"> & {
  subresources?: Record<string, string | undefined>;
}) {
  const resource = `/${ossBucket}/${objectKey}`;
  const entries = Object.entries(subresources ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return resource;
  }

  return `${resource}?${entries
    .map(([name, value]) => (value ? `${name}=${value}` : name))
    .join("&")}`;
}

function signV1(secretKey: string, stringToSign: string) {
  return createHmac("sha1", secretKey).update(stringToSign).digest("base64");
}

function buildSignedUrl({
  method,
  contentType = "",
  identity,
  token,
  expiresInSeconds,
}: {
  method: "GET" | "PUT";
  contentType?: string;
  identity: OssObjectIdentity;
  token: OssUploadToken;
  expiresInSeconds: number;
}) {
  const boundedExpiresInSeconds = getUploadTokenBoundedExpiresInSeconds({
    token,
    requestedExpiresInSeconds: expiresInSeconds,
  });
  const expires = Math.floor(Date.now() / 1000) + boundedExpiresInSeconds;
  const canonicalResource = buildCanonicalResource({
    ossBucket: identity.ossBucket,
    objectKey: identity.objectKey,
    subresources: {
      "security-token": token.stsAccessSecurityToken,
    },
  });
  const stringToSign = [method, "", contentType, String(expires), canonicalResource].join("\n");
  const signature = signV1(token.stsAccessKeySecret, stringToSign);
  const signedUrl = new URL(buildObjectUrl(identity, identity.objectKey));

  signedUrl.searchParams.set("OSSAccessKeyId", token.stsAccessKeyId);
  signedUrl.searchParams.set("Expires", String(expires));
  signedUrl.searchParams.set("Signature", signature);
  signedUrl.searchParams.set("security-token", token.stsAccessSecurityToken);

  return {
    signedUrl: signedUrl.toString(),
    signedUrlExpiresAt: expires * 1000,
  };
}

export async function signOssObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_OSS_SIGNED_URL_TTL_SECONDS,
  location,
  token: providedToken,
}: {
  objectKey: string;
  expiresInSeconds?: number;
  location: OssObjectLocation;
  token?: OssUploadToken;
}) {
  const token = providedToken ?? (await getCurrentOssUploadToken());

  return buildSignedUrl({
    method: "GET",
    identity: {
      ...location,
      objectKey,
    },
    token,
    expiresInSeconds,
  });
}

export async function getCachedSignedOssObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_OSS_SIGNED_URL_TTL_SECONDS,
  location,
  token: providedToken,
}: {
  objectKey: string;
  expiresInSeconds?: number;
  location: OssObjectLocation;
  token?: OssUploadToken;
}) {
  const token = providedToken ?? (await getCurrentOssUploadToken());
  const cacheKey = [
    "v2",
    location.ossBucket,
    location.ossEndpoint,
    location.ossRegion,
    objectKey,
    token.stsAccessKeyId,
    token.updatedAt,
    expiresInSeconds,
  ].join(":");
  const cached = signedOssObjectUrlCache.get(cacheKey);

  if (cached && cached.signedUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
    return cached;
  }

  const nextSignedUrl = buildSignedUrl({
    method: "GET",
    identity: {
      ...location,
      objectKey,
    },
    token,
    expiresInSeconds,
  });

  signedOssObjectUrlCache.set(cacheKey, nextSignedUrl);
  return nextSignedUrl;
}

export async function signOssObjectUploadUrl({
  objectKey,
  contentType,
  expiresInSeconds = 60 * 10,
  location,
  token: providedToken,
}: {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
  location: OssObjectLocation;
  token?: OssUploadToken;
}) {
  const token = providedToken ?? (await getCurrentOssUploadToken());

  return buildSignedUrl({
    method: "PUT",
    contentType,
    identity: {
      ...location,
      objectKey,
    },
    token,
    expiresInSeconds,
  });
}

export async function getCurrentOssUploadLocation() {
  const token = await getCurrentOssUploadToken();

  return {
    token,
    location: getOssLocationFromUploadToken(token),
  };
}

export async function uploadOssObject({
  body,
  contentType,
  objectKey,
  token,
  ossBucket,
  ossEndpoint,
  ossRegion,
}: UploadOssObjectOptions) {
  const date = new Date().toUTCString();
  const canonicalizedOssHeaders = buildCanonicalizedOssHeaders({
    "x-oss-security-token": token.stsAccessSecurityToken,
  });
  const canonicalResource = buildCanonicalResource({
    ossBucket,
    objectKey,
  });
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalizedOssHeaders}${canonicalResource}`;
  const signature = signV1(token.stsAccessKeySecret, stringToSign);
  const url = buildObjectUrl({ ossBucket, ossEndpoint, ossRegion }, objectKey);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `OSS ${token.stsAccessKeyId}:${signature}`,
      "Content-Length": body.byteLength.toString(),
      "Content-Type": contentType,
      Date: date,
      "x-oss-security-token": token.stsAccessSecurityToken,
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OSS upload failed (${response.status}): ${errorText || "unknown error"}`);
  }

  return {
    objectKey,
    ossBucket,
    ossEndpoint,
    ossRegion,
  };
}

/**
 * Sets the object ACL to public-read so MuseDAM can download the reference image.
 */
export async function setOssObjectAclPublicRead(
  identity: OssObjectIdentity,
  token: OssUploadToken,
): Promise<void> {
  const date = new Date().toUTCString();
  const aclValue = "public-read";
  const canonicalizedOssHeaders = buildCanonicalizedOssHeaders({
    "x-oss-object-acl": aclValue,
    "x-oss-security-token": token.stsAccessSecurityToken,
  });
  const canonicalResource = buildCanonicalResource({
    ossBucket: identity.ossBucket,
    objectKey: identity.objectKey,
    subresources: {
      acl: "",
    },
  });
  const stringToSign = `PUT\n\n\n${date}\n${canonicalizedOssHeaders}${canonicalResource}`;
  const signature = signV1(token.stsAccessKeySecret, stringToSign);
  const url = `${buildObjectUrl(identity, identity.objectKey)}?acl`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `OSS ${token.stsAccessKeyId}:${signature}`,
      Date: date,
      "x-oss-object-acl": aclValue,
      "x-oss-security-token": token.stsAccessSecurityToken,
      "Content-Length": "0",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OSS PutObjectACL failed (${response.status}): ${errorText || "unknown error"}`,
    );
  }
}
