// @vitest-environment node

import { cropProductImageToDataUrl } from "@/lib/product/image-preparation";
import {
  fetchRemoteImageInput,
  type ClassificationRemoteImageInput,
} from "@/lib/tagging/classification-image";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

async function pixels(dataUrl: string) {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(",")[1], "base64"))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([info.width, info.height, info.channels]).toEqual([512, 512, 3]);
  return (x: number, y: number) =>
    Array.from(data.subarray((y * 512 + x) * 3, (y * 512 + x) * 3 + 3));
}

function mockDownload(buffer: Buffer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(new Uint8Array(buffer), {
          headers: { "content-type": "image/png" },
        }),
    ),
  );
}

describe("product crops from the source image", () => {
  it("maps a small preview box back to the source and preserves both ends before padding", async () => {
    const raw = Buffer.alloc(2048 * 1024 * 3, 30);
    for (let y = 256; y < 320; y++) {
      for (let x = 512; x < 544; x++) {
        raw.set(y < 264 ? [255, 0, 0] : y >= 312 ? [0, 0, 255] : [0, 180, 0], (y * 2048 + x) * 3);
      }
    }
    const source = await sharp(raw, { raw: { width: 2048, height: 1024, channels: 3 } })
      .png()
      .toBuffer();
    mockDownload(source);
    const imageInput = await fetchRemoteImageInput("https://example.test/image.png", "test", {
      preserveOriginal: true,
    });
    expect([imageInput.width, imageInput.height]).toEqual([1280, 640]);
    // The crop is only 20×40 in the preview, but 32×64 in the source.
    const box = { xMin: 320, yMin: 160, xMax: 340, yMax: 200 };
    const at = await pixels(await cropProductImageToDataUrl({ imageInput, box }));
    expect(at(256, 32)).toEqual([255, 0, 0]);
    expect(at(256, 480)).toEqual([0, 0, 255]);
    expect(at(256, 256)).toEqual([0, 180, 0]);
    expect(at(64, 256)).toEqual([255, 255, 255]);
    expect(at(448, 256)).toEqual([255, 255, 255]);
  });

  it("extracts from EXIF-oriented source coordinates", async () => {
    const source = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "blue" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 100, height: 100, channels: 3, background: "red" },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    mockDownload(source);
    const imageInput = await fetchRemoteImageInput("https://example.test/rotated.png", "test", {
      preserveOriginal: true,
    });
    expect([imageInput.width, imageInput.height]).toEqual([100, 300]);
    const at = await pixels(
      await cropProductImageToDataUrl({
        imageInput,
        box: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 },
      }),
    );
    expect(at(256, 256)).toEqual([255, 0, 0]);
    expect(at(16, 16)).toEqual([255, 0, 0]);
  });

  it("supports supplied images without a separate original and rejects off-image regions", async () => {
    const buffer = await sharp({
      create: { width: 14, height: 11, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const imageInput: ClassificationRemoteImageInput = {
      width: 14,
      height: 11,
      buffer,
      byteLength: buffer.length,
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
    const at = await pixels(
      await cropProductImageToDataUrl({
        imageInput,
        box: { xMin: 0, yMin: 0, xMax: 14, yMax: 11 },
      }),
    );
    expect(at(256, 256)).toEqual([255, 0, 0]);
    expect(at(256, 10)).toEqual([255, 255, 255]);
    await expect(
      cropProductImageToDataUrl({ imageInput, box: { xMin: 20, yMin: 0, xMax: 30, yMax: 5 } }),
    ).rejects.toThrow("outside");
  });
});
