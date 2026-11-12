import "server-only";

import { z } from "zod";
import { resolveMediaProcessTeamId, runMediaProcessRequest } from "./client";

const VIDEO_FRAME_COUNT = 12;
const VIDEO_SAMPLING_INTERVAL_SECONDS = 0.25;
const VIDEO_FRAME_WIDTH = 1280;
const VIDEO_FRAME_REQUEST_TIMEOUT_MS = 4 * 60_000;

const videoFramesSchema = z.object({
  frames: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        timestamp: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(VIDEO_FRAME_COUNT),
});

export async function requestVideoFrames(
  teamId: number,
  videoUrl: string,
  signal: AbortSignal,
  frameCount = VIDEO_FRAME_COUNT,
) {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > VIDEO_FRAME_COUNT) {
    throw new Error("Invalid video frame count");
  }
  const errorPrefix = "Video frame extraction";
  const mediaProcessTeamId = await resolveMediaProcessTeamId(teamId, errorPrefix);
  const result = await runMediaProcessRequest({
    entrypoint: "video_sprite",
    errorPrefix,
    timeoutMs: VIDEO_FRAME_REQUEST_TIMEOUT_MS,
    signal,
    requestBody: JSON.stringify({
      file: videoUrl,
      team_id: mediaProcessTeamId,
      output_frames: true,
      frame_count: frameCount,
      // Person-video debugging requests one first frame; retain that existing behaviour.
      ...(frameCount > 1 ? { min_frame_interval_seconds: VIDEO_SAMPLING_INTERVAL_SECONDS } : {}),
      width: VIDEO_FRAME_WIDTH,
    }),
  });
  const parsed = videoFramesSchema.safeParse(result);
  if (!parsed.success || parsed.data.frames.length > frameCount) {
    throw new Error("Media process returned an invalid video frame result");
  }
  // Frame-rate rounding may place samples just under the requested interval.
  // Keep short shots; only duplicate timestamps are redundant. Count is already bounded.
  const frames: typeof parsed.data.frames = [];
  for (const frame of parsed.data.frames.sort((a, b) => a.timestamp - b.timestamp)) {
    const previous = frames.at(-1);
    if (!previous || frame.timestamp > previous.timestamp) {
      frames.push(frame);
    }
  }
  return frames;
}
