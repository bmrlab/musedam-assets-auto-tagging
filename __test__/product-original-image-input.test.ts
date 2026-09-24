import { fetchRemoteImageInput } from "@/lib/tagging/classification-image";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logging", () => ({ rootLogger: { warn: vi.fn() } }));

function mockImageFetch(source: Buffer, mimeType = "image/jpeg") {
  const fetch = vi.fn(async () =>
    new Response(new Uint8Array(source), {
      status: 200,
      headers: { "content-type": mimeType },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("product original-image input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains the exact full-resolution source alongside one bounded detection preview", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "#456789" },
    })
      .jpeg()
      .toBuffer();
    const fetch = mockImageFetch(source);

    const input = await fetchRemoteImageInput("https://example.test/product.jpg", "product", {
      preserveOriginal: true,
    });

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://example.test/product.jpg");
    expect(input).toMatchObject({ width: 1280, height: 853, mimeType: "image/jpeg" });
    expect(input.byteLength).toBe(input.buffer.length);
    expect(input.dataUrl).toBe(`data:image/jpeg;base64,${input.buffer.toString("base64")}`);
    expect(await sharp(input.buffer).metadata()).toMatchObject({ width: 1280, height: 853 });
    expect(input.original).toEqual({
      width: 2400,
      height: 1600,
      mimeType: "image/jpeg",
      buffer: source,
    });
  });

  it("describes original dimensions in the same EXIF-oriented frame as the preview", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "#345678" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const fetch = mockImageFetch(source);

    const input = await fetchRemoteImageInput("https://example.test/rotated.jpg", "product", {
      preserveOriginal: true,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await sharp(source).metadata()).toMatchObject({
      width: 2400,
      height: 1600,
      orientation: 6,
    });
    expect(input).toMatchObject({ width: 853, height: 1280 });
    expect(input.original).toEqual({
      width: 1600,
      height: 2400,
      mimeType: "image/jpeg",
      buffer: source,
    });
    const previewMeta = await sharp(input.buffer).metadata();
    expect(previewMeta).toMatchObject({ width: 853, height: 1280 });
    expect(previewMeta.orientation).toBeUndefined();
  });

  it("keeps the default input behavior without retaining original bytes", async () => {
    const source = await sharp({
      create: { width: 2400, height: 1600, channels: 3, background: "#567890" },
    })
      .png()
      .toBuffer();
    mockImageFetch(source, "image/png");

    const input = await fetchRemoteImageInput("https://example.test/image.png", "brand");

    expect(input).toMatchObject({ width: 1280, height: 853, mimeType: "image/jpeg" });
    expect(input).not.toHaveProperty("original");
  });

  it("rejects an undecodable source instead of mapping crops against a raw fallback", async () => {
    const source = await sharp({
      create: { width: 400, height: 600, channels: 3, background: "#456789" },
    })
      .png()
      .toBuffer();
    // A valid PNG header has parseable dimensions, but no decodable image data.
    mockImageFetch(source.subarray(0, 33), "image/png");

    await expect(
      fetchRemoteImageInput("https://example.test/broken.png", "product", {
        preserveOriginal: true,
      }),
    ).rejects.toThrow();
  });
});
