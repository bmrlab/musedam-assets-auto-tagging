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
import { tryHybridVideoFrames } from "./hybrid-video-frames";
import type { DecisionFeatureType } from "./regions";
import type { FeatureLlmContext } from "./types";
import {
  createVideoContactSheet,
  measureVideoFrame,
  selectVideoFrames,
} from "./video-frame-selection";

const VIDEO_PREPARATION_TIMEOUT_MS = 8 * 60_000;
const prepareFrameSlot = pLimit(4);

export async function prepareVideoAssetEvidence(
  input: FeatureLlmContext & {
    videoUrl: string;
    enabledTypes: DecisionFeatureType[];
    fileName?: string;
    folderPath?: string;
    ocrSegments?: string[];
    onOcr?: (ocr: import("./types").FeatureOcrDiagnostics) => void;
    imageMode?: boolean;
    allowTextFallback?: boolean;
    onProgress?: (stage: string) => void;
    mode?: "llm" | "legacy";
    requestMode?: MediaProcessRequestMode;
    signal?: AbortSignal;
    preparationTimeoutMs?: number;
  },
) {
  const decisionSignal = queueAbortSignal(input.signal);
  const preparationTimeout = AbortSignal.timeout(VIDEO_PREPARATION_TIMEOUT_MS);
  const signal = decisionSignal
    ? AbortSignal.any([preparationTimeout, decisionSignal])
    : preparationTimeout;
  const samplingSignal = input.preparationTimeoutMs === undefined ? signal
    : AbortSignal.any([signal, AbortSignal.timeout(input.preparationTimeoutMs)]);
  input.onProgress?.("video_sampling");
  const local = await tryHybridVideoFrames(input.videoUrl, samplingSignal);
  const frames = local.frames.length
    ? []
    : await requestVideoFrames(input.teamId, input.videoUrl, samplingSignal);
  input.onProgress?.("frame_preparation");
  const prepared = await Promise.allSettled(
    frames.map(({ url, timestamp, scene_index }) =>
      prepareFrameSlot(async () => {
        samplingSignal.throwIfAborted();
        const imageInput = await fetchRemoteImageInput(url, "video feature frame", {
          preserveOriginal: input.enabledTypes.includes("product"),
          signal: samplingSignal,
        });
        const quality = await measureVideoFrame(imageInput.buffer);
        return { imageInput, timestamp, scene_index, ...quality };
      }),
    ),
  );
  samplingSignal.throwIfAborted();
  const localPrepared = await Promise.all(
    local.frames.map(async ({ buffer, timestamp, scene_index }) => {
      const { width, height } = await sharp(buffer).metadata();
      if (!width || !height) throw new Error("Invalid local video frame");
      return {
        timestamp,
        scene_index,
        ...(await measureVideoFrame(buffer)),
        imageInput: {
          buffer,
          width,
          height,
          mimeType: "image/jpeg",
          byteLength: buffer.length,
          dataUrl: bufferToDataUrl(buffer, "image/jpeg"),
        },
      };
    }),
  );
  const selected = selectVideoFrames([
    ...localPrepared,
    ...prepared.flatMap((frame) => (frame.status === "fulfilled" ? [frame.value] : [])),
  ]);
  if (!selected.length) throw new Error("No sampled video frames could be prepared");
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
  const sheet = imageMode
    ? await createVideoContactSheet(selected.map((frame) => frame.imageInput))
    : null;
  return {
    sampling: local.diagnostics,
    video: {
      frames: selected,
      sourceImage: sheet ? bufferToDataUrl(sheet.buffer, "image/jpeg") : "",
      sheetColumns: sheet?.columns ?? 0,
      frameLoadFailures:
        prepared.length - prepared.filter((frame) => frame.status === "fulfilled").length,
      signal,
      decisionSignal,
      requestMode: input.requestMode,
    },
  };
}

export async function classifyVideoAssetFeatures(
  input: Parameters<typeof prepareVideoAssetEvidence>[0] & {
    prepareVideo?: () => ReturnType<typeof prepareVideoAssetEvidence>;
  },
) {
  const prepared = await (input.prepareVideo?.() ?? prepareVideoAssetEvidence(input));
  // Reused sampling must still respect this consumer's own deadline / feature budget.
  const decisionSignal = input.prepareVideo ? queueAbortSignal(input.signal) : undefined;
  const video = decisionSignal ? {
    ...prepared.video,
    signal: AbortSignal.any([prepared.video.signal, decisionSignal]),
    decisionSignal,
  } : prepared.video;
  const result = await classifyAssetFeatures({ ...input, video });
  if (result.diagnostics.video) result.diagnostics.video.sampling = prepared.sampling;
  return result;
}
