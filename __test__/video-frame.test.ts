// @vitest-environment node
import { extractVideoOcrFrame } from "@/lib/tagging/video-frame";
import { access, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ output: "", fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd, args, _options, callback) => {
    state.output = args.at(-1);
    if (state.fail) {
      callback(new Error("decode failed"));
      return;
    }
    writeFile(state.output, Buffer.from("jpeg-frame")).then(() => callback(null, "", ""));
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  state.fail = false;
  state.output = "";
});
describe("bounded video OCR frames", () => {
  it("extracts a local frame and removes temporary files after success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("video")),
    );
    expect(await extractVideoOcrFrame("https://asset.test/video", 4000)).toBe(
      `data:image/jpeg;base64,${Buffer.from("jpeg-frame").toString("base64")}`,
    );
    await expect(access(state.output)).rejects.toThrow();
    const { execFile } = await import("node:child_process");
    expect(execFile).toHaveBeenLastCalledWith(
      "ffmpeg",
      expect.arrayContaining(["file,pipe", "1"]),
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function),
    );
    expect(JSON.stringify(vi.mocked(execFile).mock.calls.at(-1)?.[1])).not.toContain("https://");
  });
  it("rejects oversized videos before decoding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("video", { headers: { "content-length": String(129 * 1024 * 1024) } }),
      ),
    );
    await expect(extractVideoOcrFrame("https://asset.test/video")).rejects.toThrow("128 MB");
  });
  it("cleans up a failed decode so the queue can use its thumbnail fallback", async () => {
    state.fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("video")),
    );
    await expect(extractVideoOcrFrame("https://asset.test/video")).rejects.toThrow(
      "Video frame extraction failed",
    );
    await expect(access(state.output)).rejects.toThrow();
  });
});
