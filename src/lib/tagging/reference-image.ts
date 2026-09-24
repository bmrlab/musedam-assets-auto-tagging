import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import {
  JINA_IMAGE_MAX_DIMENSION,
  JINA_IMAGE_TARGET_BYTES,
  JINA_SQUARE_IMAGE_DIMENSION,
  REFERENCE_IMAGE_JPEG_QUALITY,
  REFERENCE_IMAGE_MAX_DIMENSION,
  TARGET_COMPRESSED_IMAGE_BYTES,
} from "@/lib/brand/upload-constants";
import sharp from "sharp";

const MAX_COMPRESSION_ATTEMPTS = 6;
const MIN_JPEG_QUALITY = 50;
const JPEG_QUALITY_DECREMENT = 8;
const MIN_OUTPUT_DIMENSION = 256;

export type PreparedReferenceImage = {
  buffer: Buffer;
  byteLength: number;
  height: number;
  mimeType: "image/jpeg";
  width: number;
};

type PrepareReferenceImageOptions = {
  maxDimension?: number;
  targetBytes?: number;
};

/**
 * Produces a bounded, orientation-correct image for reference storage and embedding requests.
 * This is intentionally strict: unsupported or corrupt images fail instead of falling back to
 * an unbounded original that could make the downstream request exceed its payload limit.
 */
export async function prepareReferenceImageBuffer(
  sourceBuffer: Buffer,
  {
    maxDimension: requestedMaxDimension = REFERENCE_IMAGE_MAX_DIMENSION,
    targetBytes = TARGET_COMPRESSED_IMAGE_BYTES,
  }: PrepareReferenceImageOptions = {},
): Promise<PreparedReferenceImage> {
  let maxDimension = requestedMaxDimension;
  let quality = REFERENCE_IMAGE_JPEG_QUALITY;

  for (let attempt = 0; attempt < MAX_COMPRESSION_ATTEMPTS; attempt += 1) {
    const { data, info } = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });

    if (data.length <= targetBytes) {
      return {
        buffer: data,
        byteLength: data.length,
        height: info.height,
        mimeType: "image/jpeg",
        width: info.width,
      };
    }

    const scaleFactor = Math.max(0.5, Math.min(0.9, Math.sqrt(targetBytes / data.length) * 0.95));
    maxDimension = Math.max(MIN_OUTPUT_DIMENSION, Math.round(maxDimension * scaleFactor));
    quality = Math.max(MIN_JPEG_QUALITY, quality - JPEG_QUALITY_DECREMENT);
  }

  throw new Error(`Unable to compress reference image below ${targetBytes} bytes`);
}

/**
 * Keeps the complete product at a consistent scale for Jina's square image input.
 * Regions use pixels in the orientation-correct original, before resizing.
 * PNG avoids introducing another lossy encode when a prepared crop reaches Jina.
 */
export async function prepareSquareEmbeddingImageBuffer(
  sourceBuffer: Buffer,
  region?: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  let pipeline = sharp(sourceBuffer).rotate();
  if (region) {
    pipeline = pipeline.extract(region);
  }

  return pipeline
    .toColourspace("srgb")
    .flatten({ background: "#fff" })
    .resize({
      width: JINA_SQUARE_IMAGE_DIMENSION,
      height: JINA_SQUARE_IMAGE_DIMENSION,
      fit: "contain",
      position: "centre",
      background: "#fff",
      kernel: sharp.kernel.cubic,
      withoutEnlargement: false,
    })
    .removeAlpha()
    .png()
    .toBuffer();
}

function dataUrlToBuffer(image: string) {
  const match = image.match(/^data:[^;]+;base64,([\s\S]+)$/);
  if (!match) {
    throw new Error("Jina image input must be a base64 data URL");
  }

  return Buffer.from(match[1], "base64");
}

export async function prepareJinaImageDataUrl(
  image: string,
  { padToSquare = false }: { padToSquare?: boolean } = {},
) {
  const sourceBuffer = dataUrlToBuffer(image);
  if (padToSquare) {
    const buffer = await prepareSquareEmbeddingImageBuffer(sourceBuffer);
    return bufferToDataUrl(buffer, "image/png");
  }

  const prepared = await prepareReferenceImageBuffer(sourceBuffer, {
    maxDimension: JINA_IMAGE_MAX_DIMENSION,
    targetBytes: JINA_IMAGE_TARGET_BYTES,
  });

  return bufferToDataUrl(prepared.buffer, prepared.mimeType);
}
