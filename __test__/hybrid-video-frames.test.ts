// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { hasLocalVideoTools, hybridTimestamps, sampleLocalVideo } from "@/lib/feature-decision/hybrid-video-frames";
import { measureVideoFrame, selectVideoFrames } from "@/lib/feature-decision/video-frame-selection";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const run = promisify(execFile);
it("bounds mixed sampling and keeps a short shot missed by uniform sampling", () => {
  const uniform = hybridTimestamps(12, 24, []);
  const hybrid = hybridTimestamps(12, 24, [4, 4.5]);
  expect(uniform.some(f => f.timestamp >= 4 && f.timestamp < 4.5)).toBe(false);
  expect(hybrid.some(f => f.timestamp >= 4 && f.timestamp < 4.5)).toBe(true);
  expect(hybrid.length).toBeLessThanOrEqual(12);
  expect(hybrid.every((f, i) => !i || f.timestamp - hybrid[i - 1].timestamp >= 0.25 - 1e-6)).toBe(true);
  expect(hybridTimestamps(0.04, 25, [])).toEqual([{ timestamp: 0, scene_index: undefined }]);
});
it("measures real ffmpeg sampling and detection-frame coverage on synthetic clips", async ctx => {
  if (!await hasLocalVideoTools()) return ctx.skip();
  const dir = await mkdtemp(join(tmpdir(), "hybrid-benchmark-"));
  try {
    for (const [name, source, filter] of [
      ["short-product-shot", "color=red:s=640x360:r=24:d=12", "drawbox=c=yellow:t=fill:enable='between(t,4,4.49)',drawbox=c=blue:t=fill:enable='gte(t,4.5)'"],
      ["continuous-motion", "testsrc2=s=640x360:r=24:d=12", "null"],
    ]) {
      const file = join(dir, `${name}.mp4`);
      await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", source, "-vf", filter, "-c:v", "libx264", "-y", file]);
      const measurements = [];
      for (const strategy of ["uniform", "hybrid"] as const) {
        const result = await sampleLocalVideo(file, dir, AbortSignal.timeout(45000), strategy);
        const selected = selectVideoFrames(await Promise.all(result.frames.map(async f => ({ ...f, ...await measureVideoFrame(f.buffer) }))));
        const shortShot = selected.some(f => f.timestamp >= 4 && f.timestamp < 4.5);
        measurements.push({ requestedStrategy: strategy, sampled: result.frames.length, detected: selected.length, shortShot, ...result.diagnostics });
        expect(result.frames.length).toBeLessThanOrEqual(12);
        expect(selected.length).toBeLessThanOrEqual(8);
        if (name === "short-product-shot") expect(shortShot).toBe(strategy === "hybrid");
      }
      console.log("SAMPLING_BENCHMARK", name, JSON.stringify(measurements));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 60000);
