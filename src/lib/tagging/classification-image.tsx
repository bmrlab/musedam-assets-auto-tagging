import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import { rootLogger } from "@/lib/logging";
import { IMAGE_FETCH_TIMEOUT_MS } from "@/lib/tagging/external-timeouts";
import pLimit from "p-limit";
import sharp from "sharp";

// Shared non-person downsampling and crop-output settings. Person detection uses a separate
// full-resolution path below so small faces are not lost before SCRFD/ArcFace processing.
const MAX_IMAGE_DIMENSION = Number(process.env.TAGGING_MAX_IMAGE_DIMENSION ?? 1280);
const MAX_CROP_DIMENSION = Number(process.env.TAGGING_MAX_CROP_DIMENSION ?? 768);
const IMAGE_JPEG_QUALITY = Number(process.env.TAGGING_IMAGE_JPEG_QUALITY ?? 82);
const PERSON_IMAGE_JPEG_QUALITY = 95;
// 远程图片下载与解码的硬上限：超出直接报错（调用方可退回缩略图），不把极端大的文件整个读进内存。
// 注意 MuseDAM 对 PNG 等图片给的 thumbnailAccessUrl 就是原图（同一个文件），上限太低会让大图的
// 品牌/商品识别整个做不了；实测 9200 万像素、~100MB 的 PNG 顺序解码只多占 ~100MB 内存。
const MAX_REMOTE_IMAGE_BYTES = Number(process.env.TAGGING_MAX_REMOTE_IMAGE_MB ?? 300) * 1024 * 1024;
const MAX_INPUT_PIXELS = Number(process.env.TAGGING_MAX_INPUT_MEGAPIXELS ?? 120) * 1_000_000;
const SHARP_INPUT_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true } as const;
// 超大原图下载后先缩成长边不超过这个值的工作图，后续品牌/IP 预览、人物检测、商品裁剪、画幅比例都用它：
// 原图（如 95MB、1.3 万像素宽的 PNG）只顺序解码这一次，随后即可被回收，不再被各环节反复解码。
// 取 4096：并发处理多张大图时内存可控（实测 5 个 1.3 万像素 PNG 并发，6144 时 +753MB、4096 时 +605MB），
// 对人物检测的小脸仍保留足够分辨率；画幅比例只看宽高比，不受缩放影响。
const WORKING_IMAGE_MAX_DIMENSION = Number(process.env.TAGGING_WORKING_IMAGE_MAX_DIMENSION ?? 4096);
const WORKING_IMAGE_JPEG_QUALITY = 92;
// 大文件（下载 + 解码 + 缩成工作图）全局串行：单张 ~100MB 的 PNG 处理时内存峰值约 +500MB，
// 并发 6 时几个大图任务同时下载解码，子进程瞬间冲到 1.7GB、容器逼近 2Gi 被杀。缩成工作图后内存就降下来，
// 后续步骤仍按任务并发执行。打标和特征提取（参考图）共用这个槽位。
const HEAVY_IMAGE_BYTES = Number(process.env.TAGGING_HEAVY_IMAGE_MB ?? 16) * 1024 * 1024;
const heavyImageSlot = pLimit(Number(process.env.TAGGING_HEAVY_IMAGE_CONCURRENCY ?? 1));

/** 响应的 content-length（没有时返回 null，按大文件处理） */
export function getResponseByteLength(response: Response): number | null {
  const value = Number(response.headers.get("content-length"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 大文件或大小未知时，在全局大图槽位里执行（同一时间只处理一张大图） */
export function withHeavyImageSlot<T>(
  byteLength: number | null,
  run: () => Promise<T>,
): Promise<T> {
  return byteLength === null || byteLength > HEAVY_IMAGE_BYTES ? heavyImageSlot(run) : run();
}
// Brand/IP retain a bounded number of detection crops. Product regions and person faces are not capped.
export const MAX_DETECTION_CROPS = Number(process.env.TAGGING_MAX_DETECTION_CROPS ?? 8);

export type ClassificationImageMeta = {
  width: number;
  height: number;
};

export type ClassificationRemoteImageInput = ClassificationImageMeta & {
  mimeType: string;
  byteLength: number;
  buffer: Buffer;
  dataUrl: string;
  // URL-based detectors return pixels in this remote file's EXIF-oriented coordinate frame.
  sourceImage?: ClassificationImageMeta & { url: string };
  // Original encoded bytes with dimensions after EXIF orientation, for crops mapped from
  // the bounded detector preview. Consumers must apply orientation before extracting.
  original?: ClassificationImageMeta & {
    buffer: Buffer;
    mimeType: string;
  };
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

/** Downloaded, not yet decoded image bytes. Fetch once per task and share between consumers. */
export type RemoteImageSource = {
  imageUrl: string;
  buffer: Buffer;
  mimeType: string;
  // Retain remote dimensions when the downloaded buffer is reduced to a working image.
  sourceDimensions?: ClassificationImageMeta;
};

export async function fetchRemoteImageSource(
  imageUrl: string,
  failureContext: string,
): Promise<RemoteImageSource> {
  // 超限时直接中断请求；不 await body.cancel()（经 HTTP 代理时取消可能一直挂着，任务就卡在这里）
  const abortController = new AbortController();
  let response: Response;
  try {
    response = await fetch(imageUrl, {
      signal: AbortSignal.any([
        abortController.signal,
        AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      ]),
    });
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

  const contentLength = getResponseByteLength(response);
  if (contentLength !== null && contentLength > MAX_REMOTE_IMAGE_BYTES) {
    abortController.abort();
    throw new RemoteImageTooLargeError(failureContext, contentLength);
  }

  return withHeavyImageSlot(contentLength, async () => {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
      throw new RemoteImageTooLargeError(failureContext, buffer.length);
    }

    return boundRemoteImageSource(
      {
        imageUrl,
        mimeType:
          response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
        buffer,
      },
      failureContext,
    );
  });
}

/** 超大图片缩成工作图（见 WORKING_IMAGE_MAX_DIMENSION），用于只需要整图的场景（如参考图向量）。 */
export async function downscaleImageBufferIfHuge(
  buffer: Buffer,
  mimeType: string,
  failureContext: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const bounded = await boundRemoteImageSource({ imageUrl: "", buffer, mimeType }, failureContext);
  return { buffer: bounded.buffer, mimeType: bounded.mimeType };
}

/** 超大图片缩成有上限的工作图（见 WORKING_IMAGE_MAX_DIMENSION）；读不了或本来就不大时原样返回。 */
async function boundRemoteImageSource(
  source: RemoteImageSource,
  failureContext: string,
): Promise<RemoteImageSource> {
  let width: number;
  let height: number;
  try {
    ({ width, height } = (await sharp(source.buffer, SHARP_INPUT_OPTIONS).metadata()).autoOrient);
  } catch {
    return source; // 交给后续环节按原逻辑处理（包括像素超限报错）
  }
  const sourceDimensions = source.sourceDimensions ?? { width, height };
  if (Math.max(width, height) <= WORKING_IMAGE_MAX_DIMENSION) {
    return { ...source, sourceDimensions };
  }

  const { data, info } = await sharp(source.buffer, SHARP_INPUT_OPTIONS)
    .rotate()
    .resize({
      width: WORKING_IMAGE_MAX_DIMENSION,
      height: WORKING_IMAGE_MAX_DIMENSION,
      fit: "inside",
    })
    .flatten({ background: "#fff" })
    .jpeg({ quality: WORKING_IMAGE_JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  rootLogger.info({
    msg: "Large remote image downscaled to working image",
    failureContext,
    original: { width, height, bytes: source.buffer.length },
    working: { width: info.width, height: info.height, bytes: data.length },
  });
  return { imageUrl: source.imageUrl, mimeType: "image/jpeg", buffer: data, sourceDimensions };
}

/** 同一个对象的不同签名地址（如 MuseDAM PNG 的 thumbnailAccessUrl 与 downloadUrl 只差查询参数）。 */
export function isSameRemoteObject(a: string, b: string) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host === right.host && left.pathname === right.pathname;
  } catch {
    return a === b;
  }
}

function isPixelLimitError(error: unknown) {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

/** 图片过大：下载字节数或像素数超过上限，调用方可以退回缩略图。 */
export function isImageTooLargeError(error: unknown) {
  return error instanceof RemoteImageTooLargeError || isPixelLimitError(error);
}

export class RemoteImageTooLargeError extends Error {
  constructor(failureContext: string, byteLength: number) {
    super(
      `${failureContext} image is too large (${Math.round(byteLength / 1024 / 1024)}MB > ${Math.round(MAX_REMOTE_IMAGE_BYTES / 1024 / 1024)}MB)`,
    );
    this.name = "RemoteImageTooLargeError";
  }
}

/**
 * Pixel dimensions after EXIF orientation, read from the image header only (no full decode or
 * re-encode). Enough for aspect-ratio tagging.
 */
export async function readRemoteImageDimensions(
  source: RemoteImageSource,
): Promise<ClassificationImageMeta> {
  try {
    const { autoOrient } = await sharp(source.buffer, SHARP_INPUT_OPTIONS).metadata();
    return { width: autoOrient.width, height: autoOrient.height };
  } catch {
    return getImageDimensions(source.buffer, source.mimeType);
  }
}

async function prepareRemoteImageInput(
  { imageUrl, buffer: originalBuffer, mimeType: sourceMimeType, sourceDimensions }: RemoteImageSource,
  failureContext: string,
  {
    maxDimension,
    jpegQuality,
    preserveOriginal = false,
  }: {
    maxDimension: number | null;
    jpegQuality: number;
    preserveOriginal?: boolean;
  },
): Promise<ClassificationRemoteImageInput> {
  // Normalize EXIF orientation and output format so detector coordinates, browser display, and
  // server-side crops use the same coordinate system. Person inputs deliberately skip resize.
  let bufferDimensions: ClassificationImageMeta | undefined;
  try {
    const { autoOrient } = await sharp(originalBuffer, SHARP_INPUT_OPTIONS).metadata();
    bufferDimensions = { width: autoOrient.width, height: autoOrient.height };
    let original: ClassificationRemoteImageInput["original"];
    if (preserveOriginal) {
      original = {
        ...bufferDimensions,
        buffer: originalBuffer,
        mimeType: sourceMimeType,
      };
    }

    let pipeline = sharp(originalBuffer, SHARP_INPUT_OPTIONS).rotate();
    if (maxDimension !== null) {
      pipeline = pipeline.resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const { data, info } = await pipeline
      .flatten({ background: "#fff" })
      .jpeg({ quality: jpegQuality })
      .toBuffer({ resolveWithObject: true });

    return {
      width: info.width,
      height: info.height,
      mimeType: "image/jpeg",
      byteLength: data.length,
      buffer: data,
      dataUrl: bufferToDataUrl(data, "image/jpeg"),
      sourceImage: { url: imageUrl, ...(sourceDimensions ?? bufferDimensions) },
      ...(original ? { original } : {}),
    };
  } catch (error) {
    rootLogger.warn({
      msg: preserveOriginal
        ? "fetchRemoteImageInput preparation failed for original-image cropping"
        : "fetchRemoteImageInput preparation failed, falling back to original buffer",
      fn: "fetchRemoteImageInput",
      failureContext,
      sourceMimeType,
      byteLength: originalBuffer.length,
      ...summarizeImageUrl(imageUrl),
      ...serializeError(error),
    });
    // Mapping detector boxes to original pixels requires a successfully normalized preview.
    // Raw fallback dimensions can be in a different coordinate frame because of EXIF.
    // 超过像素上限的大图也不能退回原始字节（整张转 base64 同样会撑爆内存）。
    if (preserveOriginal || isPixelLimitError(error)) {
      throw error;
    }
  }

  // 回退：sharp 无法处理时（极少数格式）沿用原图，保证功能不退化
  let meta: ClassificationImageMeta;
  try {
    meta = bufferDimensions ?? getImageDimensions(originalBuffer, sourceMimeType);
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
    // Do not invent an oriented frame if metadata could not establish one.
    ...(bufferDimensions
      ? { sourceImage: { url: imageUrl, ...(sourceDimensions ?? bufferDimensions) } }
      : {}),
  };
}

/** Bounded, orientation-corrected JPEG for brand/IP/product classification. */
export async function prepareImageInput(
  source: RemoteImageSource,
  failureContext: string,
  { preserveOriginal = false }: { preserveOriginal?: boolean } = {},
): Promise<ClassificationRemoteImageInput> {
  return prepareRemoteImageInput(source, failureContext, {
    maxDimension: MAX_IMAGE_DIMENSION,
    jpegQuality: IMAGE_JPEG_QUALITY,
    preserveOriginal,
  });
}

/** Orientation-corrected person image without reducing its pixel dimensions. */
export async function preparePersonImageInput(
  source: RemoteImageSource,
  failureContext: string,
): Promise<ClassificationRemoteImageInput> {
  return prepareRemoteImageInput(source, failureContext, {
    maxDimension: null,
    jpegQuality: PERSON_IMAGE_JPEG_QUALITY,
  });
}

export async function fetchRemoteImageInput(
  imageUrl: string,
  failureContext: string,
  options: { preserveOriginal?: boolean } = {},
): Promise<ClassificationRemoteImageInput> {
  return prepareImageInput(
    await fetchRemoteImageSource(imageUrl, failureContext),
    failureContext,
    options,
  );
}

/**
 * Fetches an orientation-corrected person image without reducing its pixel dimensions.
 * The source object is only read; the original stored image is never overwritten.
 */
export async function fetchRemotePersonImageInput(
  imageUrl: string,
  failureContext: string,
): Promise<ClassificationRemoteImageInput> {
  return preparePersonImageInput(
    await fetchRemoteImageSource(imageUrl, failureContext),
    failureContext,
  );
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
    const jpegBuffer = await sharp(sourceBuffer)
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
