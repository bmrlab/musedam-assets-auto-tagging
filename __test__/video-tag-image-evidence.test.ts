import { classifyVideoAssetFeatures, prepareVideoAssetEvidence } from "@/lib/feature-decision/video-classification";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sample: vi.fn(), fetch: vi.fn(), sheet: vi.fn(), classify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/media-process/video-frames", () => ({ requestVideoFrames: mocks.sample }));
vi.mock("@/lib/feature-decision/hybrid-video-frames", () => ({
  tryHybridVideoFrames: async () => ({ frames: [], diagnostics: { strategy: "media_service" } }),
}));
vi.mock("@/lib/tagging/classification-image", () => ({ fetchRemoteImageInput: mocks.fetch }));
vi.mock("@/lib/feature-decision/classify", () => ({ classifyAssetFeatures: mocks.classify }));
vi.mock("@/lib/feature-decision/video-frame-selection", () => ({
  measureVideoFrame: async () => ({ fingerprint: Buffer.alloc(1), sharpness: 1, blank: false }),
  selectVideoFrames: (frames: unknown[]) => frames.slice(0, 8),
  createVideoContactSheet: mocks.sheet,
}));
const input = { teamId: 1, videoUrl: "https://example.test/video.mp4", enabledTypes: [] as [], imageMode: true };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sample.mockResolvedValue([{ url: "https://example.test/frame.jpg", timestamp: 1 }]);
  mocks.fetch.mockResolvedValue({ buffer: Buffer.from("frame"), width: 100, height: 100 });
  mocks.sheet.mockResolvedValue({ buffer: Buffer.from("sheet"), columns: 1 });
  mocks.classify.mockResolvedValue({ diagnostics: { video: {} } });
});

it("prepares a shared sheet even with no feature types configured", async () => {
  const result = await prepareVideoAssetEvidence(input);
  expect(result.video.sourceImage).toBe("data:image/jpeg;base64,c2hlZXQ=");
  expect(result.video.frames).toHaveLength(1);
  expect(result.sampling).toEqual({ strategy: "media_service" });
});

it("reuses prepared evidence without starting another sampler", async () => {
  const prepared = await prepareVideoAssetEvidence(input);
  const result = await classifyVideoAssetFeatures({ ...input, prepareVideo: async () => prepared });
  expect(mocks.sample).toHaveBeenCalledTimes(1);
  expect(mocks.sheet).toHaveBeenCalledTimes(1);
  expect(mocks.classify.mock.calls[0][0].video).toBe(prepared.video);
  expect(result.diagnostics.video?.sampling).toEqual(prepared.sampling);
});

it("limits preparation without prematurely cancelling subsequent feature decisions", async () => {
  const controller = new AbortController();
  const prepared = await prepareVideoAssetEvidence({ ...input, signal: controller.signal, preparationTimeoutMs: 20 });
  const samplingSignal = mocks.sample.mock.calls[0][2] as AbortSignal;
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(samplingSignal.aborted).toBe(true);
  expect(prepared.video.signal.aborted).toBe(false);
  expect(prepared.video.decisionSignal?.aborted).toBe(false);
  controller.abort();
  expect(prepared.video.decisionSignal?.aborted).toBe(true);
});

it("preserves text-only feature sampling without building a sheet", async () => {
  const prepared = await prepareVideoAssetEvidence({ ...input, imageMode: false });
  expect(prepared.video.frames).toHaveLength(1);
  expect(prepared.video.sourceImage).toBe("");
  expect(mocks.sheet).not.toHaveBeenCalled();
});

it("honors a feature consumer's deadline when reusing existing sampling", async () => {
  const prepared = await prepareVideoAssetEvidence(input);
  const controller = new AbortController();
  await classifyVideoAssetFeatures({ ...input, signal: controller.signal, prepareVideo: async () => prepared });
  const video = mocks.classify.mock.calls[0][0].video;
  controller.abort();
  expect(video.signal.aborted).toBe(true);
  expect(video.decisionSignal.aborted).toBe(true);
  expect(prepared.video.signal.aborted).toBe(false);
  expect(mocks.sample).toHaveBeenCalledTimes(1);
});
