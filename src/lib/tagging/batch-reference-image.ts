import "server-only";

import {
  MAX_CLIENT_IMAGE_UPLOAD_BYTES,
  REFERENCE_IMAGE_MAX_DIMENSION,
  TARGET_COMPRESSED_IMAGE_BYTES,
} from "@/lib/brand/upload-constants";
import { isConfiguredS3PublicObjectUrl } from "@/lib/s3";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_COMPRESSION_ATTEMPTS = 10;
const INITIAL_COMPRESSION_QUALITY = 90;
const MIN_COMPRESSION_QUALITY = 45;
const COMPRESSION_QUALITY_DECREMENT = 8;
const MIN_IMAGE_DIMENSION = 154;
const SCALE_FACTOR_FLOOR = 0.5;
const SCALE_FACTOR_CEILING = 0.92;
const SCALE_FACTOR_BUFFER = 0.98;

const SOURCE_IMAGE_FORMATS: Record<string, { extension: string; mimeType: string }> = {
  avif: { extension: ".avif", mimeType: "image/avif" },
  gif: { extension: ".gif", mimeType: "image/gif" },
  jpeg: { extension: ".jpg", mimeType: "image/jpeg" },
  png: { extension: ".png", mimeType: "image/png" },
  svg: { extension: ".svg", mimeType: "image/svg+xml" },
  webp: { extension: ".webp", mimeType: "image/webp" },
};

export class BatchReferenceImageError extends Error {
  constructor(
    readonly code:
      | "invalid_url"
      | "download_failed"
      | "file_too_large"
      | "invalid_image"
      | "compression_failed",
  ) {
    super(code);
  }
}

function isPublicIpAddress(address: string) {
  const normalized = address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const ipVersion = isIP(normalized);

  if (ipVersion === 4) {
    const parts = normalized.split(".").map(Number);
    const [first, second] = parts;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19 || (second === 51 && parts[2] === 100))) ||
      (first === 203 && second === 0 && parts[2] === 113) ||
      first >= 224
    );
  }

  if (ipVersion === 6) {
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }

  return false;
}

async function parsePublicImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BatchReferenceImageError("invalid_url");
  }

  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new BatchReferenceImageError("invalid_url");
  }

  const isConfiguredS3Url = isConfiguredS3PublicObjectUrl(url);
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !hostname ||
    (!isConfiguredS3Url &&
      (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")))
  ) {
    throw new BatchReferenceImageError("invalid_url");
  }

  if (isConfiguredS3Url) {
    return url;
  }

  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
      throw new BatchReferenceImageError("invalid_url");
    }
  } catch (error) {
    if (error instanceof BatchReferenceImageError) throw error;
    throw new BatchReferenceImageError("download_failed");
  }

  return url;
}

async function fetchPublicImage(imageUrl: string) {
  let url = await parsePublicImageUrl(imageUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new BatchReferenceImageError("download_failed");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new BatchReferenceImageError("download_failed");
      }

      await response.body?.cancel();
      url = await parsePublicImageUrl(new URL(location, url).toString());
      continue;
    }

    if (!response.ok || !response.body) {
      throw new BatchReferenceImageError("download_failed");
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_CLIENT_IMAGE_UPLOAD_BYTES) {
      await response.body.cancel();
      throw new BatchReferenceImageError("file_too_large");
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_CLIENT_IMAGE_UPLOAD_BYTES) {
          await reader.cancel();
          throw new BatchReferenceImageError("file_too_large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      totalBytes,
    );
  }

  throw new BatchReferenceImageError("download_failed");
}

async function prepareBatchReferenceImage(sourceBuffer: Buffer) {
  const metadata = await sharp(sourceBuffer).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new BatchReferenceImageError("invalid_image");
  }

  const sourceFormat = SOURCE_IMAGE_FORMATS[metadata.format];
  const maxEdge = Math.max(metadata.width, metadata.height);
  const requiresCompression =
    sourceBuffer.byteLength > TARGET_COMPRESSED_IMAGE_BYTES ||
    maxEdge > REFERENCE_IMAGE_MAX_DIMENSION ||
    !sourceFormat;

  if (!requiresCompression && sourceFormat) {
    return {
      buffer: sourceBuffer,
      byteLength: sourceBuffer.byteLength,
      extension: sourceFormat.extension,
      mimeType: sourceFormat.mimeType,
    };
  }

  const outputJpeg = metadata.format === "jpeg";
  let maxDimension = REFERENCE_IMAGE_MAX_DIMENSION;
  let quality = INITIAL_COMPRESSION_QUALITY;

  for (let attempt = 0; attempt < MAX_COMPRESSION_ATTEMPTS; attempt += 1) {
    let pipeline = sharp(sourceBuffer).rotate().resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
    pipeline = outputJpeg
      ? pipeline.jpeg({ quality })
      : pipeline.webp({ quality, smartSubsample: true });

    const buffer = await pipeline.toBuffer();
    if (buffer.byteLength <= TARGET_COMPRESSED_IMAGE_BYTES) {
      return {
        buffer,
        byteLength: buffer.byteLength,
        extension: outputJpeg ? ".jpg" : ".webp",
        mimeType: outputJpeg ? "image/jpeg" : "image/webp",
      };
    }

    const scaleFactor = Math.max(
      SCALE_FACTOR_FLOOR,
      Math.min(
        SCALE_FACTOR_CEILING,
        Math.sqrt(TARGET_COMPRESSED_IMAGE_BYTES / buffer.byteLength) * SCALE_FACTOR_BUFFER,
      ),
    );
    maxDimension = Math.max(MIN_IMAGE_DIMENSION, Math.round(maxDimension * scaleFactor));
    quality = Math.max(MIN_COMPRESSION_QUALITY, quality - COMPRESSION_QUALITY_DECREMENT);
  }

  throw new BatchReferenceImageError("compression_failed");
}

export async function downloadAndPrepareBatchReferenceImage(imageUrl: string) {
  const sourceBuffer = await fetchPublicImage(imageUrl);

  try {
    return await prepareBatchReferenceImage(sourceBuffer);
  } catch (error) {
    if (error instanceof BatchReferenceImageError) throw error;
    throw new BatchReferenceImageError("invalid_image");
  }
}
