// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ execFile: vi.fn((_cmd, _args, _opts, callback) => callback(Object.assign(new Error("missing"), { code: "ENOENT" }))) }));
it("uses the media service without downloading when ffmpeg is missing", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    const { tryHybridVideoFrames } = await import("@/lib/feature-decision/hybrid-video-frames");
    expect(await tryHybridVideoFrames("https://example.test/private", new AbortController().signal)).toMatchObject({ frames: [], diagnostics: { strategy: "media_service", reason: "local_tools_unavailable" } });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(tryHybridVideoFrames("https://example.test/private", controller.signal)).rejects.toThrow();
  } finally { vi.unstubAllGlobals(); }
});
