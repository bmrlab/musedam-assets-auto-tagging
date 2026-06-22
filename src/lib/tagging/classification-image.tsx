import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import { rootLogger } from "@/lib/logging";
import sharp from "sharp";

// 约束 sharp(libvips)的堆外内存：关闭操作缓存、把原生线程数收到 1。
// 多并发图片处理时,sharp 的原生内存不计入 V8 堆(NODE_OPTIONS 管不到),
// 累积/峰值过高会直接撑爆容器内存上限触发 OOMKilled。
sharp.cache(false);
sharp.concurrency(1);

// 下载即降采样 / 裁剪输出的统一配置（可用环境变量覆盖）
// 目的：避免把全分辨率原图整张读进内存再 PNG 编码，显著降低 CPU/内存峰值
const MAX_IMAGE_DIMENSION = Number(process.env.TAGGING_MAX_IMAGE_DIMENSION ?? 1280);
const MAX_CROP_DIMENSION = Number(process.env.TAGGING_MAX_CROP_DIMENSION ?? 768);
const IMAGE_JPEG_QUALITY = Number(process.env.TAGGING_IMAGE_JPEG_QUALITY ?? 82);
// 单张图最多裁剪多少个检测框，防止一张图裁出几十个框导致内存/CPU 失控
export const MAX_DETECTION_CROPS = Number(process.env.TAGGING_MAX_DETECTION_CROPS ?? 8);

// 单图内存硬上限：防止"超大原图"或"像素炸弹(文件小但解码后巨大)"撑爆容器内存。
// 这些是 OOMKilled 的直接元凶，且不受 NODE_OPTIONS 约束（属堆外/原生内存）。
const MAX_DOWNLOAD_BYTES = Number(process.env.TAGGING_MAX_DOWNLOAD_BYTES ?? 25 * 1024 * 1024);
// sharp/libvips 解码像素上限（宽×高）。默认 5000 万像素（约 7000×7000），
// 超过直接抛错（被上层 withFallback 捕获、跳过该图），而不是分配数 GB 原生内存。
const MAX_INPUT_PIXELS = Number(process.env.TAGGING_MAX_INPUT_PIXELS ?? 50_000_000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.TAGGING_DOWNLOAD_TIMEOUT_MS ?? 20_000);
// 统一的 sharp 输入选项：限制解码像素、只取首帧（动图/多页图避免全帧解码）
const SHARP_INPUT_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 } as const;

export type ClassificationImageMeta = {
  width: number;
  height: number;
};

export type ClassificationRemoteImageInput = ClassificationImageMeta & {
  mimeType: string;
  byteLength: number;
  buffer: Buffer;
  dataUrl: string;
};

export type ClassificationDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export function getFallbackBox(
  meta: ClassificationImageMeta,
  label: string = "whole image fallback",
): ClassificationDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: meta.width,
    yMax: meta.height,
    score: 1,
    label,
  };
}

export function clampBox<T extends ClassificationDetectionBox>(
  box: T,
  meta: ClassificationImageMeta,
): T {
  const xMin = Math.max(0, Math.min(meta.width, box.xMin));
  const yMin = Math.max(0, Math.min(meta.height, box.yMin));
  const xMax = Math.max(xMin + 1, Math.min(meta.width, box.xMax));
  const yMax = Math.max(yMin + 1, Math.min(meta.height, box.yMax));

  return {
    ...box,
    xMin,
    yMin,
    xMax,
    yMax,
  };
}

function isPng(buffer: Buffer) {
  return (
    buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  );
}

function isGif(buffer: Buffer) {
  return (
    buffer.length >= 10 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")
  );
}

function isJpeg(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

function isWebp(buffer: Buffer) {
  return (
    buffer.length >= 16 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function isSvg(buffer: Buffer, mimeType: string) {
  if (mimeType.includes("svg")) {
    return true;
  }

  const head = buffer.subarray(0, 512).toString("utf8").trimStart();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

function parsePngDimensions(buffer: Buffer): ClassificationImageMeta {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifDimensions(buffer: Buffer): ClassificationImageMeta {
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpegDimensions(buffer: Buffer): ClassificationImageMeta {
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }

    offset += segmentLength;
  }

  throw new Error("Unable to parse JPEG dimensions");
}

function parseWebpDimensions(buffer: Buffer): ClassificationImageMeta {
  const chunkType = buffer.subarray(12, 16).toString("ascii");

  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === "VP8L") {
    const offset = 20;
    const b0 = buffer[offset + 1];
    const b1 = buffer[offset + 2];
    const b2 = buffer[offset + 3];
    const b3 = buffer[offset + 4];

    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }

  if (chunkType === "VP8 ") {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  throw new Error("Unable to parse WEBP dimensions");
}

function parseSvgNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSvgDimensions(buffer: Buffer): ClassificationImageMeta {
  const source = buffer.toString("utf8");
  const width = parseSvgNumber(source.match(/\bwidth=["']([^"']+)["']/i)?.[1]);
  const height = parseSvgNumber(source.match(/\bheight=["']([^"']+)["']/i)?.[1]);

  if (width && height) {
    return { width, height };
  }

  const viewBox = source.match(/\bviewBox=["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox
      .split(/[\s,]+/)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));

    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return {
        width: parts[2],
        height: parts[3],
      };
    }
  }

  throw new Error("Unable to parse SVG dimensions");
}

function getImageDimensions(buffer: Buffer, mimeType: string): ClassificationImageMeta {
  if (isPng(buffer)) {
    return parsePngDimensions(buffer);
  }

  if (isJpeg(buffer)) {
    return parseJpegDimensions(buffer);
  }

  if (isGif(buffer)) {
    return parseGifDimensions(buffer);
  }

  if (isWebp(buffer)) {
    return parseWebpDimensions(buffer);
  }

  if (isSvg(buffer, mimeType)) {
    return parseSvgDimensions(buffer);
  }

  throw new Error(`Unsupported image format: ${mimeType || "unknown"}`);
}

function summarizeImageUrl(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl);
    return {
      imageUrlOrigin: parsed.origin,
      imageUrlPathname: parsed.pathname,
      imageUrlSearchKeys: Array.from(parsed.searchParams.keys()).slice(0, 10),
    };
  } catch {
    return {
      imageUrlKind: imageUrl.startsWith("data:") ? "data-url" : "unparseable-url",
    };
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      err: error,
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  return {
    err: String(error),
    errorMessage: String(error),
  };
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) {
    throw new Error("Expected a base64 data URL for image crop input");
  }

  return Buffer.from(match[1], "base64");
}

export async function fetchRemoteImageInput(
  imageUrl: string,
  failureContext: string,
): Promise<ClassificationRemoteImageInput> {
  let response: Response;
  try {
    // 加超时：避免慢/卡住的源把半截响应体长期挂在内存里累积
    response = await fetch(imageUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput failed while fetching image",
      fn: "fetchRemoteImageInput",
      failureContext,
      ...summarizeImageUrl(imageUrl),
      ...serializeError(error),
    });
    throw error;
  }

  if (!response.ok) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput received non-OK image response",
      fn: "fetchRemoteImageInput",
      failureContext,
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      ...summarizeImageUrl(imageUrl),
    });
    throw new Error(`Failed to fetch ${failureContext} image (${response.status})`);
  }

  // 下载大小上限（先看 Content-Length，能在读 body 前就拒绝超大图）
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput rejected oversized image (content-length)",
      fn: "fetchRemoteImageInput",
      failureContext,
      contentLength: declaredLength,
      maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      ...summarizeImageUrl(imageUrl),
    });
    throw new Error(`Image too large: ${declaredLength} bytes > ${MAX_DOWNLOAD_BYTES}`);
  }

  const sourceMimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const originalBuffer = Buffer.from(await response.arrayBuffer());

  // 兜底：Content-Length 可能缺失或不准，读完后再按实际大小卡一次
  if (originalBuffer.length > MAX_DOWNLOAD_BYTES) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput rejected oversized image (actual bytes)",
      fn: "fetchRemoteImageInput",
      failureContext,
      byteLength: originalBuffer.length,
      maxDownloadBytes: MAX_DOWNLOAD_BYTES,
      ...summarizeImageUrl(imageUrl),
    });
    throw new Error(`Image too large: ${originalBuffer.length} bytes > ${MAX_DOWNLOAD_BYTES}`);
  }

  // 下载即降采样：限制最大边长并统一转成 JPEG。后续检测/裁剪/embedding 都基于这张
  // 缩小后的图，坐标系一致；内存占用从“原图 buffer + base64”降到缩略图级别。
  try {
    const { data, info } = await sharp(originalBuffer, SHARP_INPUT_OPTIONS)
      .rotate() // 按 EXIF 方向校正，避免裁剪坐标错位
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality: IMAGE_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      width: info.width,
      height: info.height,
      mimeType: "image/jpeg",
      byteLength: data.length,
      buffer: data,
      dataUrl: bufferToDataUrl(data, "image/jpeg"),
    };
  } catch (error) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput downscale failed, falling back to original buffer",
      fn: "fetchRemoteImageInput",
      failureContext,
      sourceMimeType,
      byteLength: originalBuffer.length,
      ...summarizeImageUrl(imageUrl),
      ...serializeError(error),
    });
  }

  // 回退：sharp 无法处理时（极少数格式）沿用原图，保证功能不退化
  let meta: ClassificationImageMeta;
  try {
    meta = getImageDimensions(originalBuffer, sourceMimeType);
  } catch (error) {
    rootLogger.warn({
      msg: "fetchRemoteImageInput failed while parsing image dimensions",
      fn: "fetchRemoteImageInput",
      failureContext,
      mimeType: sourceMimeType,
      byteLength: originalBuffer.length,
      headerHex: originalBuffer.subarray(0, 16).toString("hex"),
      ...summarizeImageUrl(imageUrl),
      ...serializeError(error),
    });
    throw error;
  }

  return {
    ...meta,
    mimeType: sourceMimeType,
    byteLength: originalBuffer.length,
    buffer: originalBuffer,
    dataUrl: bufferToDataUrl(originalBuffer, sourceMimeType),
  };
}

export async function cropImageToDataUrl({
  imageDataUrl,
  imageBuffer,
  sourceMimeType,
  meta,
  box,
}: {
  imageDataUrl: string;
  imageBuffer?: Buffer;
  sourceMimeType?: string;
  meta: ClassificationImageMeta;
  box: ClassificationDetectionBox;
}) {
  const crop = clampBox(box, meta);
  const sourceBuffer = imageBuffer ?? dataUrlToBuffer(imageDataUrl);
  const imageWidth = Math.max(1, Math.round(meta.width));
  const imageHeight = Math.max(1, Math.round(meta.height));
  const left = Math.max(0, Math.min(imageWidth - 1, Math.floor(crop.xMin)));
  const top = Math.max(0, Math.min(imageHeight - 1, Math.floor(crop.yMin)));
  const right = Math.max(left + 1, Math.min(imageWidth, Math.ceil(crop.xMax)));
  const bottom = Math.max(top + 1, Math.min(imageHeight, Math.ceil(crop.yMax)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  try {
    const jpegBuffer = await sharp(sourceBuffer, SHARP_INPUT_OPTIONS)
      .extract({
        left,
        top,
        width,
        height,
      })
      .flatten({ background: "#fff" })
      .resize({
        width: MAX_CROP_DIMENSION,
        height: MAX_CROP_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: IMAGE_JPEG_QUALITY })
      .toBuffer();

    return bufferToDataUrl(jpegBuffer, "image/jpeg");
  } catch (error) {
    rootLogger.warn({
      msg: "cropImageToDataUrl failed",
      fn: "cropImageToDataUrl",
      sourceMimeType,
      imageWidth,
      imageHeight,
      sourceByteLength: sourceBuffer.length,
      crop: {
        left,
        top,
        width,
        height,
        label: crop.label,
        score: crop.score,
      },
      ...serializeError(error),
    });
    throw error;
  }
}

export function normalizeRecommendedTags(
  tags: Array<{
    assetTagId: number | null;
    tagPath: unknown;
  }>,
) {
  const seen = new Set<number>();

  return tags.flatMap((tag) => {
    if (!tag.assetTagId || seen.has(tag.assetTagId)) {
      return [];
    }

    seen.add(tag.assetTagId);

    return [
      {
        assetTagId: tag.assetTagId,
        tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
      },
    ];
  });
}
