import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import type { MediaProcessRequestMode } from "@/lib/media-process/client";
import { requestVideoFrames } from "@/lib/media-process/video-frames";
import { fetchRemoteImageInput } from "@/lib/tagging/classification-image";
import { queueAbortSignal } from "@/lib/tagging/queue-execution";
import pLimit from "p-limit";
import { classifyAssetFeatures } from "./classify";
import { isDecisionLlmImageUseEnabled } from "./config";
import type { DecisionFeatureType } from "./regions";
import type { FeatureLlmContext } from "./types";
import {
  createVideoContactSheet,
  measureVideoFrame,
  selectVideoFrames,
} from "./video-frame-selection";

const VIDEO_PREPARATION_TIMEOUT_MS = 8 * 60_000;
const prepareFrameSlot = pLimit(4);

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
        const quality = await measureVideoFrame(imageInput.buffer);
        return { imageInput, timestamp, ...quality };
      }),
    ),
  );
  signal.throwIfAborted();
  const selected = selectVideoFrames(
    prepared.flatMap((frame) => (frame.status === "fulfilled" ? [frame.value] : [])),
  );
  if (!selected.length) throw new Error("No sampled video frames could be prepared");
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
  const sheet = imageMode
    ? await createVideoContactSheet(selected.map((frame) => frame.imageInput))
    : null;
  return classifyAssetFeatures({
    ...input,
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
  });
}
