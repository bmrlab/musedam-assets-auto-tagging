// @vitest-environment node
import { imageMemorySnapshot, withImageDecodeSlot } from "@/lib/tagging/image-memory";
import { readImageResponse } from "@/lib/tagging/image-response";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logging", () => ({ rootLogger: { info: vi.fn() } }));

it("serializes decode jobs across callers and releases the slot after a failure", async () => {
  let finish!: () => void;
  const first = withImageDecodeSlot(
    "foreground",
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await vi.waitFor(() => expect(finish).toBeDefined());
  const second = vi.fn(async () => {
    throw new Error("decode failed");
  });
  const failed = withImageDecodeSlot("thumbnail", second);
  const rejection = expect(failed).rejects.toThrow("decode failed");
  const third = vi.fn(async () => "ok");
  const last = withImageDecodeSlot("embedding", third);
  expect(second).not.toHaveBeenCalled();
  expect(third).not.toHaveBeenCalled();
  expect(imageMemorySnapshot()).toMatchObject({ imageDecodesActive: 1, imageDecodesPending: 2 });
  finish();
  await first;
  await rejection;
  await expect(last).resolves.toBe("ok");
  expect(imageMemorySnapshot()).toMatchObject({ imageDecodesActive: 0, imageDecodesPending: 0 });
});

it.each([undefined, "1"])(
  "stops an oversized stream with Content-Length %s, even if cancellation hangs",
  async (length) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let sent = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(4));
          sent++;
        },
        cancel,
      }),
      { headers: length ? { "content-length": length } : {} },
    );
    await expect(readImageResponse(response, 5, () => new Error("too large"))).rejects.toThrow(
      "too large",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(sent).toBeLessThanOrEqual(3);
  },
);

it("rejects a declared oversize body before reading it", async () => {
  const reader = vi.fn();
  const response = new Response(new Uint8Array([1]), { headers: { "content-length": "100" } });
  vi.spyOn(response.body!, "getReader").mockImplementation(reader);
  await expect(readImageResponse(response, 5, () => new Error("too large"))).rejects.toThrow(
    "too large",
  );
  expect(reader).not.toHaveBeenCalled();
});

it("preserves valid streamed bytes", async () => {
  const response = new Response(new Uint8Array([1, 2, 3]));
  await expect(readImageResponse(response, 3, () => new Error("too large"))).resolves.toEqual(
    Buffer.from([1, 2, 3]),
  );
});
