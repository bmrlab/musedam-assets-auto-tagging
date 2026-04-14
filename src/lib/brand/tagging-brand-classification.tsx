import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import {
  BrandDetectionBox,
  classifyBrandImageCrops,
  detectBrandLogoBoxes,
} from "@/lib/brand/logo-classification";
import { TaggingBrandRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { ImageResponse } from "next/og";

const DEFAULT_LOGO_DETECTION_PROMPT = "logo . brand logo . emblem . trademark . label";

type ImageMeta = {
  width: number;
  height: number;
};

type RemoteImageInput = ImageMeta & {
  mimeType: string;
  dataUrl: string;
};

function buildLogoDetectionPromptName(name: string) {
  return name.trim();
}

async function fetchLogoDetectionPromptNames(teamId: number) {
  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true,
    },
  });

  const promptNames = Array.from(
    new Set(
      logos
        .map((logo) => buildLogoDetectionPromptName(logo.name))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  return [DEFAULT_LOGO_DETECTION_PROMPT, ...promptNames].join(" . ");
}

function getFallbackBox(meta: ImageMeta): BrandDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: meta.width,
    yMax: meta.height,
    score: 1,
    label: "whole image fallback",
  };
}

function clampBox(box: BrandDetectionBox, meta: ImageMeta): BrandDetectionBox {
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

function parsePngDimensions(buffer: Buffer): ImageMeta {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifDimensions(buffer: Buffer): ImageMeta {
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpegDimensions(buffer: Buffer): ImageMeta {
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

function parseWebpDimensions(buffer: Buffer): ImageMeta {
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

function parseSvgDimensions(buffer: Buffer): ImageMeta {
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

function getImageDimensions(buffer: Buffer, mimeType: string): ImageMeta {
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

async function fetchRemoteImageInput(imageUrl: string): Promise<RemoteImageInput> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch brand classification image (${response.status})`);
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const meta = getImageDimensions(buffer, mimeType);

  return {
    ...meta,
    mimeType,
    dataUrl: bufferToDataUrl(buffer, mimeType),
  };
}

async function cropImageToDataUrl({
  imageDataUrl,
  meta,
  box,
}: {
  imageDataUrl: string;
  meta: ImageMeta;
  box: BrandDetectionBox;
}) {
  const crop = clampBox(box, meta);
  const width = Math.max(1, Math.round(crop.xMax - crop.xMin));
  const height = Math.max(1, Math.round(crop.yMax - crop.yMin));

  const response = new ImageResponse(
    (
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          display: "flex",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "white",
        }}
      >
        <img
          src={imageDataUrl}
          width={meta.width}
          height={meta.height}
          style={{
            position: "absolute",
            left: `${-crop.xMin}px`,
            top: `${-crop.yMin}px`,
            width: `${meta.width}px`,
            height: `${meta.height}px`,
          }}
        />
      </div>
    ),
    {
      width,
      height,
    },
  );

  const pngBuffer = Buffer.from(await response.arrayBuffer());
  return bufferToDataUrl(pngBuffer, "image/png");
}

function normalizeRecommendedTags(
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

export async function classifyAssetBrandRecommendation({
  teamId,
  imageUrl,
}: {
  teamId: number;
  imageUrl?: string | null;
}): Promise<TaggingBrandRecommendation | null> {
  if (!imageUrl) {
    return null;
  }

  const detectionLabelText = await fetchLogoDetectionPromptNames(teamId);
  const imageInput = await fetchRemoteImageInput(imageUrl);
  const detection = await detectBrandLogoBoxes({
    teamId,
    imageUrl,
    detectionLabelText,
  });

  const candidateBoxes =
    detection.detections.length > 0 ? detection.detections : [getFallbackBox(imageInput)];
  const normalizedBoxes = candidateBoxes.map((box) => clampBox(box, imageInput));

  const crops = await Promise.all(
    normalizedBoxes.map(async (box) => ({
      box,
      image: await cropImageToDataUrl({
        imageDataUrl: imageInput.dataUrl,
        meta: imageInput,
        box,
      }),
    })),
  );

  const result = await classifyBrandImageCrops({
    teamId,
    crops,
  });

  if (!result.bestMatch || result.noConfidentMatch) {
    return {
      noConfidentMatch: true,
      bestMatch: result.bestMatch,
      recommendedTags: [],
    };
  }

  const logoTags = await prisma.assetLogoTag.findMany({
    where: {
      assetLogoId: result.bestMatch.assetLogoId,
      assetTagId: {
        not: null,
      },
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    select: {
      assetTagId: true,
      tagPath: true,
    },
  });

  return {
    noConfidentMatch: false,
    bestMatch: result.bestMatch,
    recommendedTags: normalizeRecommendedTags(logoTags),
  };
}
