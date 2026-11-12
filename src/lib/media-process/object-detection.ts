import "server-only";

import { buildDetectionJpegObjectKey, signS3ObjectUrl, uploadS3Object } from "@/lib/s3";
import type {
  ClassificationDetectionBox,
  ClassificationRemoteImageInput,
} from "@/lib/tagging/classification-image";
import { z } from "zod";
import {
  resolveMediaProcessTeamId,
  runMediaProcessRequest,
  type MediaProcessRequestMode,
} from "./client";

export type { MediaProcessRequestMode } from "./client";

// Total deadline for detection, including queue wait and service retries when applicable.
const OBJECT_DETECTION_TIMEOUT_MS = 30 * 60_000;

const detectionResultSchema = z.object({
  detections: z.array(
    z.object({
      x_min: z.number(),
      y_min: z.number(),
      x_max: z.number(),
      y_max: z.number(),
      score: z.number().nullish(),
      label: z.string().nullish(),
    }),
  ),
  found: z.boolean(),
});

/** Detect objects from a URL and map original-image coordinates into the existing preview. */
export async function detectMediaProcessObjects({
  teamId,
  imageInput,
  detectionLabelText,
  requestMode = "async",
  detectionMode = "default",
  defaultLabel = "object",
  errorPrefix = "Object detection",
  signal,
}: {
  teamId: number;
  imageInput: ClassificationRemoteImageInput;
  detectionLabelText: string;
  requestMode?: MediaProcessRequestMode;
  detectionMode?: "default" | "product_instances";
  defaultLabel?: string;
  errorPrefix?: string;
  signal?: AbortSignal;
}): Promise<{ detections: ClassificationDetectionBox[]; found: boolean }> {
  const source = imageInput.sourceImage;
  if (!source) throw new Error(`${errorPrefix} requires a source image URL and dimensions`);
  let fileUrl: URL;
  try {
    fileUrl = new URL(source.url);
  } catch {
    throw new Error(`${errorPrefix} requires an HTTP(S) image URL`);
  }
  if (!["http:", "https:"].includes(fileUrl.protocol)) {
    throw new Error(`${errorPrefix} requires an HTTP(S) image URL`);
  }
  if (
    ![source.width, source.height, imageInput.width, imageInput.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new Error(`${errorPrefix} has invalid image dimensions`);
  }
  const mediaProcessTeamId = await resolveMediaProcessTeamId(teamId, errorPrefix);
  // The URL-based service cannot decode SVG. The shared image preparation path has already
  // rasterized it; give the service a JPEG URL in those same preview coordinates.
  // Keep the JPEG in object storage after detection.
  let detectionSource = source;
  if (source.isSvg || imageInput.mimeType === "image/svg+xml" || /\.svg$/i.test(fileUrl.pathname)) {
    if (imageInput.mimeType !== "image/jpeg") {
      throw new Error(`${errorPrefix} requires a rasterized JPEG for SVG detection`);
    }
    const objectKey = buildDetectionJpegObjectKey(teamId);
    await uploadS3Object({
      body: imageInput.buffer,
      contentType: "image/jpeg",
      objectKey,
    });
    detectionSource = {
      url: signS3ObjectUrl({ objectKey, expiresInSeconds: 60 * 60 }).signedUrl,
      width: imageInput.width,
      height: imageInput.height,
    };
  }
  const scaleX = imageInput.width / detectionSource.width;
  const scaleY = imageInput.height / detectionSource.height;
  const requestBody = JSON.stringify({
    file: detectionSource.url,
    detection_label_text: detectionLabelText,
    detection_mode: detectionMode,
    team_id: mediaProcessTeamId,
  });
  function parseDetectionResult(payload: unknown) {
    const result = detectionResultSchema.safeParse(payload);
    if (!result.success) throw new Error(`${errorPrefix} returned an invalid detection result`);
    return {
      detections: result.data.detections.map((box) => ({
        xMin: box.x_min * scaleX,
        yMin: box.y_min * scaleY,
        xMax: box.x_max * scaleX,
        yMax: box.y_max * scaleY,
        score: box.score ?? 0,
        label: box.label ?? defaultLabel,
      })),
      found: result.data.found,
    };
  }

  const payload = await runMediaProcessRequest({
    entrypoint: "object_detection_llm",
    requestBody,
    requestMode,
    errorPrefix,
    timeoutMs: OBJECT_DETECTION_TIMEOUT_MS,
    signal,
  });
  return parseDetectionResult(payload);
}
