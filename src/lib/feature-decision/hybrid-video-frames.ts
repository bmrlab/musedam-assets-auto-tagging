import { execFile } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import "server-only";

const run = promisify(execFile);
const MAX_BYTES = 128 * 1024 * 1024;
let busy = false;
let availability: Promise<boolean> | undefined;
export type HybridFrame = { buffer: Buffer; timestamp: number; scene_index?: number };
export type SamplingDiagnostics = {
  strategy: "hybrid" | "uniform" | "media_service";
  elapsedMs: number;
  scanMs?: number;
  reason?: string;
};

export function hasLocalVideoTools() {
  return (availability ??= Promise.all(
    ["ffmpeg", "ffprobe"].map((binary) =>
      run(binary, ["-version"], { timeout: 2000, maxBuffer: 32768 }),
    ),
  ).then(
    () => true,
    () => false,
  ));
}

function spread<T>(values: T[], count: number) {
  if (count >= values.length) return [...values];
  return Array.from(
    { length: count },
    (_, i) => values[Math.floor(((i + 0.5) * values.length) / count)],
  );
}

export function hybridTimestamps(duration: number, fps: number, cuts: number[]) {
  const count = Math.min(
    12,
    Math.max(1, Math.floor(duration / 0.25)),
    Math.max(1, Math.floor(duration * fps)),
  );
  const align = (value: number) => Math.floor(value * fps) / fps;
  const uniform = Array.from({ length: count }, (_, i) => ({
    timestamp: align(((i + 0.5) * duration) / count),
    scene_index: undefined as number | undefined,
  }));
  if (!cuts.length || count < 2) return uniform;
  const boundaries = [0, ...cuts, duration];
  const scenes = boundaries
    .slice(0, -1)
    .flatMap((start, i) =>
      boundaries[i + 1] - start >= 0.25
        ? [{ timestamp: align((start + boundaries[i + 1]) / 2), scene_index: i }]
        : [],
    );
  const selected: { timestamp: number; scene_index: number | undefined }[] = spread(
    scenes,
    Math.floor(count / 2),
  );
  // Preserve temporal coverage as well as scene representatives, within the same cap.
  for (const frame of [...spread(uniform, Math.ceil(count / 2)), ...uniform]) {
    if (selected.length >= count) break;
    if (selected.every((previous) => Math.abs(previous.timestamp - frame.timestamp) >= 0.25 - 1e-6))
      selected.push(frame);
  }
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

/** Local file only: signed source URLs never reach process arguments or stderr. */
export async function sampleLocalVideo(
  file: string,
  dir: string,
  signal: AbortSignal,
  strategy: "hybrid" | "uniform" = "hybrid",
) {
  const started = Date.now();
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration:stream=avg_frame_rate",
      "-of",
      "json",
      file,
    ],
    { signal, timeout: 3000, maxBuffer: 32768 },
  );
  const metadata = JSON.parse(stdout);
  const duration = Number(metadata.format?.duration);
  const [num, den] = String(metadata.streams?.[0]?.avg_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  const fps = num / den;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 600 ||
    !Number.isFinite(fps) ||
    fps <= 0
  )
    throw new Error("unsupported_video");
  const scanStarted = Date.now();
  let cuts: number[] = [];
  let reason: string | undefined;
  if (strategy === "hybrid") {
    try {
      const { stderr } = await run(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-threads",
          "1",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          file,
          "-map",
          "0:V:0",
          "-an",
          "-sn",
          "-vf",
          "scale=160:90:force_original_aspect_ratio=decrease,fps=8,select='gt(scene,0.22)',showinfo",
          "-fps_mode",
          "vfr",
          "-f",
          "null",
          "-",
        ],
        { signal, timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
      );
      for (const match of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
        const value = Number(match[1]);
        if (
          value >= 0.25 &&
          value <= duration - 0.25 &&
          (!cuts.length || value - cuts.at(-1)! >= 0.25)
        )
          cuts.push(value);
      }
    } catch {
      signal.throwIfAborted();
      reason = "scene_scan_unavailable";
      cuts = [];
    }
  }
  const scanMs = Date.now() - scanStarted;
  const frames: HybridFrame[] = [];
  for (const [index, frame] of hybridTimestamps(duration, fps, cuts).entries()) {
    const output = join(dir, `${index}.jpg`);
    await run(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        String(frame.timestamp),
        "-i",
        file,
        "-map",
        "0:V:0",
        "-vf",
        "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-q:v",
        "2",
        "-y",
        output,
      ],
      { signal, timeout: 5000, maxBuffer: 32768 },
    );
    const buffer = await readFile(output);
    if (buffer.length) frames.push({ ...frame, buffer });
  }
  if (!frames.length) throw new Error("no_frames");
  return {
    frames,
    diagnostics: {
      strategy: cuts.length ? "hybrid" : "uniform",
      elapsedMs: Date.now() - started,
      scanMs,
      reason,
    } as SamplingDiagnostics,
  };
}

/** Optional optimization. Missing binaries, contention or resource limits use the existing service. */
export async function tryHybridVideoFrames(
  url: string,
  parentSignal: AbortSignal,
): Promise<{ frames: HybridFrame[]; diagnostics: SamplingDiagnostics }> {
  const started = Date.now();
  const fallback = (reason: string) => ({
    frames: [],
    diagnostics: { strategy: "media_service" as const, reason, elapsedMs: Date.now() - started },
  });
  parentSignal.throwIfAborted();
  if (busy) return fallback("local_decoder_busy");
  busy = true;
  let dir: string | undefined;
  try {
    if (!(await hasLocalVideoTools())) return fallback("local_tools_unavailable");
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(45000)]);
    dir = await mkdtemp(join(tmpdir(), "tagging-hybrid-"));
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok || !response.body) return fallback("download_unavailable");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body.cancel();
      return fallback("video_size_limit");
    }
    const file = join(dir, "input");
    const handle = await open(file, "w", 0o600);
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        signal.throwIfAborted();
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("video_size_limit");
        await handle.writeFile(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      await handle.close();
    }
    return await sampleLocalVideo(file, dir, signal);
  } catch {
    parentSignal.throwIfAborted();
    return fallback("local_sampling_unavailable");
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
    busy = false;
  }
}
