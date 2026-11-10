import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pLimit from "p-limit";
import "server-only";
import { queueAbortSignal } from "./queue-execution";

const run = promisify(execFile);
const frameSlot = pLimit(1);
const MAX_VIDEO_BYTES = 128 * 1024 * 1024;

/** One bounded local decode; never pass a remote/signed URL to ffmpeg or its logs. */
export async function extractVideoOcrFrame(url: string, durationMs?: number): Promise<string> {
  return frameSlot(async () => {
    const signal = queueAbortSignal(AbortSignal.timeout(60_000));
    signal?.throwIfAborted();
    const dir = await mkdtemp(join(tmpdir(), "tagging-frame-"));
    try {
      const response = await fetch(url, { signal });
      if (!response.ok || !response.body) throw new Error(`Video download HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) {
        await response.body.cancel();
        throw new Error("Video exceeds 128 MB frame extraction limit");
      }
      const video = join(dir, "input"),
        image = join(dir, "frame.jpg");
      const file = await open(video, "w", 0o600);
      const reader = response.body.getReader();
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_VIDEO_BYTES)
            throw new Error("Video exceeds 128 MB frame extraction limit");
          signal?.throwIfAborted();
          await file.writeFile(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        await file.close();
      }
      const time =
        durationMs && Number.isFinite(durationMs) && durationMs > 0
          ? Math.min(1, durationMs / 2000)
          : 0;
      try {
        await run(
          "ffmpeg",
          [
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-threads",
            "1",
            "-protocol_whitelist",
            "file,pipe",
            "-ss",
            String(time),
            "-i",
            video,
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease",
            "-q:v",
            "2",
            "-threads",
            "1",
            image,
          ],
          { signal, timeout: 30_000, maxBuffer: 32_768 },
        );
        const buffer = await readFile(image);
        if (!buffer.length) throw new Error("Empty video frame");
        return `data:image/jpeg;base64,${buffer.toString("base64")}`;
      } catch {
        signal?.throwIfAborted();
        throw new Error("Video frame extraction failed (ffmpeg required)");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
