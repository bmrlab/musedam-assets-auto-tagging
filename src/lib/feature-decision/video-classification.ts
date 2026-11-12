import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import type { MediaProcessRequestMode } from "@/lib/media-process/client";
import { requestVideoFrames } from "@/lib/media-process/video-frames";
import { fetchRemoteImageInput } from "@/lib/tagging/classification-image";
import { queueAbortSignal } from "@/lib/tagging/queue-execution";
import pLimit from "p-limit";
import sharp from "sharp";
import { classifyAssetFeatures } from "./classify";
import { isDecisionLlmImageUseEnabled } from "./config";
import type { DecisionFeatureType } from "./regions";
import type { FeatureLlmContext } from "./types";

const MAX_DETECTION_FRAMES = 8;
const VIDEO_PREPARATION_TIMEOUT_MS = 8 * 60_000;
const FRAME_FINGERPRINT_SIDE = 32;
const NEAR_DUPLICATE_MEAN_DIFFERENCE = 3;
const SHEET_COLUMNS = 4;
const TILE_WIDTH = 384;
const TILE_HEIGHT = 512;
const prepareFrameSlot = pLimit(4);

type PreparedFrame = {
  timestamp: number;
  imageInput: Awaited<ReturnType<typeof fetchRemoteImageInput>>;
  fingerprint: Buffer;
};

function isNearDuplicate(a: Buffer, b: Buffer) {
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference += Math.abs(a[index] - b[index]);
    if (difference > NEAR_DUPLICATE_MEAN_DIFFERENCE * a.length) return false;
  }
  return true;
}

function selectDetectionFrames(frames: PreparedFrame[]) {
  const remaining = [...frames];
  const selected: PreparedFrame[] = [];
  while (remaining.length && selected.length < MAX_DETECTION_FRAMES) {
    const distance = (frame: PreparedFrame) =>
      Math.min(...selected.map((previous) => Math.abs(previous.timestamp - frame.timestamp)));
    if (selected.length) remaining.sort((a, b) => distance(b) - distance(a));
    const frame = remaining.shift()!;
    if (!selected.some((previous) => isNearDuplicate(previous.fingerprint, frame.fingerprint))) {
      selected.push(frame);
    }
  }
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

async function createContactSheet(frames: PreparedFrame[]) {
  const columns = Math.min(SHEET_COLUMNS, frames.length);
  const background = "#181818";
  const tiles = await Promise.all(
    frames.map(async (frame, index) => ({
      input: await sharp(frame.imageInput.buffer)
        .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "contain", background })
        .jpeg()
        .toBuffer(),
      left: (index % columns) * TILE_WIDTH,
      top: Math.floor(index / columns) * TILE_HEIGHT,
    })),
  );
  const buffer = await sharp({
    create: {
      width: columns * TILE_WIDTH,
      height: Math.ceil(frames.length / columns) * TILE_HEIGHT,
      channels: 3,
      background,
    },
  })
    .composite(tiles)
    .jpeg({ quality: 88 })
    .toBuffer();
  return bufferToDataUrl(buffer, "image/jpeg");
}

export async function classifyVideoAssetFeatures(
  input: FeatureLlmContext & {
    videoUrl: string;
    enabledTypes: DecisionFeatureType[];
    fileName?: string;
    folderPath?: string;
    ocrSegments?: string[];
    imageMode?: boolean;
    mode?: "llm" | "legacy";
    requestMode?: MediaProcessRequestMode;
    signal?: AbortSignal;
  },
) {
  const decisionSignal = queueAbortSignal(input.signal);
  const preparationTimeout = AbortSignal.timeout(VIDEO_PREPARATION_TIMEOUT_MS);
  const signal = decisionSignal
    ? AbortSignal.any([preparationTimeout, decisionSignal])
    : preparationTimeout;
  const frames = await requestVideoFrames(input.teamId, input.videoUrl, signal);
  const prepared = await Promise.allSettled(
    frames.map(({ url, timestamp }) =>
      prepareFrameSlot(async () => {
        signal.throwIfAborted();
        const imageInput = await fetchRemoteImageInput(url, "video feature frame", {
          preserveOriginal: input.enabledTypes.includes("product"),
          signal,
        });
        const fingerprint = await sharp(imageInput.buffer)
          .resize(FRAME_FINGERPRINT_SIDE, FRAME_FINGERPRINT_SIDE, { fit: "fill" })
          .toColourspace("srgb")
          .removeAlpha()
          .raw()
          .toBuffer();
        return { imageInput, timestamp, fingerprint };
      }),
    ),
  );
  signal.throwIfAborted();
  const selected = selectDetectionFrames(
    prepared.flatMap((frame) => (frame.status === "fulfilled" ? [frame.value] : [])),
  );
  if (!selected.length) throw new Error("No sampled video frames could be prepared");
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
  return classifyAssetFeatures({
    ...input,
    video: {
      frames: selected,
      sourceImage: imageMode ? await createContactSheet(selected) : "",
      sheetColumns: Math.min(SHEET_COLUMNS, selected.length),
      frameLoadFailures:
        prepared.length - prepared.filter((frame) => frame.status === "fulfilled").length,
      signal,
      decisionSignal,
      requestMode: input.requestMode,
    },
  });
}
