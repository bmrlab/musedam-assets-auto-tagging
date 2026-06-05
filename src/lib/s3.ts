import "server-only";

import { createHash, createHmac, randomUUID } from "crypto";

const DEFAULT_S3_SIGNED_URL_TTL_SECONDS = 60 * 30;
const SIGNED_URL_REFRESH_BUFFER_MS = 60 * 1000;
const BROWSER_S3_OBJECT_PROXY_PATH = "/api/tagging/s3-object";
type BrowserS3ObjectProxyMethod = "GET" | "PUT";
const signedS3ObjectUrlCache = new Map<
  string,
  {
    signedUrl: string;
    signedUrlExpiresAt: number;
  }
>();
const browserS3ObjectUrlCache = new Map<
  string,
  {
    signedUrl: string;
    signedUrlExpiresAt: number;
  }
>();

type UploadS3ObjectOptions = {
  contentType: string;
  objectKey: string;
  body: Buffer;
};

type SignS3ObjectUploadUrlOptions = {
  contentType: string;
  objectKey: string;
  expiresInSeconds?: number;
};

type S3Config = {
  accessKeyId: string;
  bucket: string;
  endpointUrl: string;
  region: string;
  secretAccessKey: string;
  sessionToken?: string;
};

type AssetObjectKind = "logos" | "ips" | "persons" | "products";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing S3 config: ${name}`);
  }
  return value;
}

function getS3Config(): S3Config {
  return {
    accessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
    bucket: getRequiredEnv("S3_BUCKET"),
    endpointUrl: getRequiredEnv("S3_ENDPOINT_URL"),
    region: getRequiredEnv("S3_REGION"),
    secretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

function isLocalDev() {
  return process.env.LOCAL_DEV === "true";
}

function normalizeS3Folder(folder: string | undefined) {
  return (folder || "").replace(/^\/+|\/+$/g, "");
}

function buildStorageObjectKey(objectKey: string) {
  const folder = normalizeS3Folder(process.env.S3_FOLDER);
  const normalizedObjectKey = objectKey.replace(/^\/+/, "");

  return folder ? `${folder}/${normalizedObjectKey}` : normalizedObjectKey;
}

export function isTeamS3ObjectKey({
  kind,
  objectKey,
  teamId,
}: {
  kind: AssetObjectKind;
  objectKey: string;
  teamId: number;
}) {
  return objectKey.startsWith(buildStorageObjectKey(`teams-${teamId}-asset-${kind}-`));
}

function buildS3ObjectUrl(objectKey: string) {
  const { bucket, endpointUrl } = getS3Config();
  const endpoint = new URL(endpointUrl.endsWith("/") ? endpointUrl : `${endpointUrl}/`);
  const basePath = endpoint.pathname.replace(/\/+$/g, "");
  const objectPath = [bucket, ...objectKey.split("/")].map(encodeURIComponent).join("/");

  endpoint.pathname = `${basePath}/${objectPath}`;
  return endpoint;
}

function signBrowserS3ObjectProxyUrl({
  method,
  objectKey,
  signedUrlExpiresAt,
}: {
  method: BrowserS3ObjectProxyMethod;
  objectKey: string;
  signedUrlExpiresAt: number;
}) {
  const { secretAccessKey } = getS3Config();
  return createHmac("sha256", secretAccessKey)
    .update(`${method}:${objectKey}:${signedUrlExpiresAt}`)
    .digest("hex");
}

function buildBrowserS3ObjectProxyUrl({
  method,
  objectKey,
  expiresInSeconds,
}: {
  method: BrowserS3ObjectProxyMethod;
  objectKey: string;
  expiresInSeconds: number;
}) {
  const signedUrlExpiresAt = (Math.floor(Date.now() / 1000) + expiresInSeconds) * 1000;
  const objectPath = objectKey
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(`${BROWSER_S3_OBJECT_PROXY_PATH}/${objectPath}`, "http://localhost");

  url.searchParams.set("expiresAt", String(signedUrlExpiresAt));
  url.searchParams.set(
    "signature",
    signBrowserS3ObjectProxyUrl({
      method,
      objectKey,
      signedUrlExpiresAt,
    }),
  );

  return {
    signedUrl: `${url.pathname}${url.search}`,
    signedUrlExpiresAt,
  };
}

export function verifyBrowserS3ObjectProxyUrl({
  method,
  objectKey,
  signature,
  signedUrlExpiresAt,
}: {
  method: BrowserS3ObjectProxyMethod;
  objectKey: string;
  signature: string | null;
  signedUrlExpiresAt: number;
}) {
  if (!isLocalDev()) {
    return false;
  }

  if (!signature || !Number.isFinite(signedUrlExpiresAt) || signedUrlExpiresAt <= Date.now()) {
    return false;
  }

  const expectedSignature = signBrowserS3ObjectProxyUrl({
    method,
    objectKey,
    signedUrlExpiresAt,
  });

  return signature === expectedSignature;
}

function formatAmzDate(date = new Date()) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate,
    dateStamp: amzDate.slice(0, 8),
  };
}

function sha256Hex(value: string | Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmacSha256(dateKey, region);
  const dateRegionServiceKey = hmacSha256(dateRegionKey, "s3");
  return hmacSha256(dateRegionServiceKey, "aws4_request");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalizeQueryParams(params: Array<[string, string]>) {
  return params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function createCanonicalHeaders(headers: Record<string, string>) {
  const normalizedHeaders = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    canonicalHeaders: normalizedHeaders.map(([key, value]) => `${key}:${value}\n`).join(""),
    signedHeaders: normalizedHeaders.map(([key]) => key).join(";"),
  };
}

function signS3Request({
  method,
  payloadHash,
  requestHeaders,
  url,
}: {
  method: string;
  payloadHash: string;
  requestHeaders: Record<string, string>;
  url: URL;
}) {
  const config = getS3Config();
  const { amzDate, dateStamp } = formatAmzDate();
  const headers = {
    ...requestHeaders,
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(config.sessionToken ? { "x-amz-security-token": config.sessionToken } : {}),
  };
  const { canonicalHeaders, signedHeaders } = createCanonicalHeaders(headers);
  const queryParams = [...url.searchParams.entries()];
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalizeQueryParams(queryParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    getSigningKey(config.secretAccessKey, dateStamp, config.region),
  )
    .update(stringToSign)
    .digest("hex");
  const fetchHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key !== "host"),
  );

  return {
    headers: {
      ...fetchHeaders,
      Authorization: [
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(", "),
    },
  };
}

function signS3Url({
  method,
  objectKey,
  expiresInSeconds,
}: {
  method: string;
  objectKey: string;
  expiresInSeconds: number;
}) {
  const config = getS3Config();
  const url = buildS3ObjectUrl(objectKey);
  const { amzDate, dateStamp } = formatAmzDate();
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const signedHeaders = "host";
  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  if (config.sessionToken) {
    queryParams.push(["X-Amz-Security-Token", config.sessionToken]);
  }

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalizeQueryParams(queryParams),
    `host:${url.host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac(
    "sha256",
    getSigningKey(config.secretAccessKey, dateStamp, config.region),
  )
    .update(stringToSign)
    .digest("hex");

  for (const [key, value] of queryParams) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("X-Amz-Signature", signature);

  return {
    signedUrl: url.toString(),
    signedUrlExpiresAt: (Math.floor(Date.now() / 1000) + expiresInSeconds) * 1000,
  };
}

export function buildAssetLogoObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return buildStorageObjectKey(
    `teams-${teamId}-asset-logos-${Date.now()}-${randomUUID()}${safeExtension}`,
  );
}

export function buildAssetIpObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return buildStorageObjectKey(
    `teams-${teamId}-asset-ips-${Date.now()}-${randomUUID()}${safeExtension}`,
  );
}

export function buildAssetProductObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return buildStorageObjectKey(
    `teams-${teamId}-asset-products-${Date.now()}-${randomUUID()}${safeExtension}`,
  );
}

export function buildAssetPersonObjectKey({
  teamId,
  extension,
}: {
  teamId: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  return buildStorageObjectKey(
    `teams-${teamId}-asset-persons-${Date.now()}-${randomUUID()}${safeExtension}`,
  );
}

export function getS3ObjectUrl(objectKey: string) {
  return buildS3ObjectUrl(objectKey).toString();
}

export function getS3PublicObjectUrl(objectKey: string) {
  return getS3ObjectUrl(objectKey);
}

export function signS3ObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_S3_SIGNED_URL_TTL_SECONDS,
}: {
  objectKey: string;
  expiresInSeconds?: number;
}) {
  return signS3Url({
    method: "GET",
    objectKey,
    expiresInSeconds,
  });
}

export function getCachedSignedS3ObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_S3_SIGNED_URL_TTL_SECONDS,
}: {
  objectKey: string;
  expiresInSeconds?: number;
}) {
  const cacheKey = `${objectKey}:${expiresInSeconds}`;
  const cached = signedS3ObjectUrlCache.get(cacheKey);

  if (cached && cached.signedUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
    return cached;
  }

  const nextSignedUrl = signS3ObjectUrl({
    objectKey,
    expiresInSeconds,
  });

  signedS3ObjectUrlCache.set(cacheKey, nextSignedUrl);
  return nextSignedUrl;
}

export function getCachedBrowserS3ObjectUrl({
  objectKey,
  expiresInSeconds = DEFAULT_S3_SIGNED_URL_TTL_SECONDS,
}: {
  objectKey: string;
  expiresInSeconds?: number;
}) {
  if (!isLocalDev()) {
    return getCachedSignedS3ObjectUrl({
      objectKey,
      expiresInSeconds,
    });
  }

  const cacheKey = `${objectKey}:${expiresInSeconds}`;
  const cached = browserS3ObjectUrlCache.get(cacheKey);

  if (cached && cached.signedUrlExpiresAt > Date.now() + SIGNED_URL_REFRESH_BUFFER_MS) {
    return cached;
  }

  const nextSignedUrl = buildBrowserS3ObjectProxyUrl({
    method: "GET",
    objectKey,
    expiresInSeconds,
  });

  browserS3ObjectUrlCache.set(cacheKey, nextSignedUrl);
  return nextSignedUrl;
}

export function getBrowserS3ObjectUploadUrl({
  contentType,
  objectKey,
  expiresInSeconds = 60 * 10,
}: SignS3ObjectUploadUrlOptions) {
  if (!isLocalDev()) {
    return signS3ObjectUploadUrl({
      contentType,
      objectKey,
      expiresInSeconds,
    });
  }

  return buildBrowserS3ObjectProxyUrl({
    method: "PUT",
    objectKey,
    expiresInSeconds,
  });
}

export function signS3ObjectUploadUrl({
  objectKey,
  expiresInSeconds = 60 * 10,
}: SignS3ObjectUploadUrlOptions) {
  return signS3Url({
    method: "PUT",
    objectKey,
    expiresInSeconds,
  });
}

export async function uploadS3Object({ body, contentType, objectKey }: UploadS3ObjectOptions) {
  const url = buildS3ObjectUrl(objectKey);
  const payloadHash = sha256Hex(body);
  const { headers } = signS3Request({
    method: "PUT",
    payloadHash,
    requestHeaders: {
      "Content-Type": contentType,
    },
    url,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`S3 upload failed (${response.status}): ${errorText || "unknown error"}`);
  }

  return {
    objectKey,
  };
}
