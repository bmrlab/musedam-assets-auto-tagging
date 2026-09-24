import { prepareClientImageUpload, shouldCompressClientImage } from "@/lib/brand/browser-image";
import {
  BYTES_PER_MB,
  JINA_IMAGE_MAX_DIMENSION,
  JINA_IMAGE_TARGET_BYTES,
  JINA_SQUARE_IMAGE_DIMENSION,
  REFERENCE_IMAGE_MAX_DIMENSION,
} from "@/lib/brand/upload-constants";
import {
  prepareJinaImageDataUrl,
  prepareReferenceImageBuffer,
  prepareSquareEmbeddingImageBuffer,
} from "@/lib/tagging/reference-image";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

async function stripedImage(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = height > width ? y : x;
      const length = Math.max(width, height);
      const color =
        position < length / 8
          ? [255, 0, 0]
          : position >= (length * 7) / 8
            ? [0, 0, 255]
            : [0, 180, 0];
      pixels.set(color, (y * width + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function readPixels(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    at: (x: number, y: number) =>
      Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)),
  };
}

function expectColor(actual: number[], expected: number[]) {
  expected.forEach((channel, index) => expect(Math.abs(actual[index] - channel)).toBeLessThan(15));
}

describe("reference image preparation", () => {
  it("keeps person uploads byte-for-byte original when requested", async () => {
    const original = new File(["original-person-image"], "student-id.jpg", {
      type: "image/jpeg",
    });

    const prepared = await prepareClientImageUpload(original, { preserveOriginal: true });

    expect(prepared).toBe(original);
    expect(prepared.name).toBe("student-id.jpg");
    expect(prepared.size).toBe(original.size);
    expect(prepared.type).toBe("image/jpeg");
  });

  it("requires compression for a small-file, high-resolution local image", () => {
    expect(
      shouldCompressClientImage({
        fileSize: 2.7 * BYTES_PER_MB,
        width: 4000,
        height: 4000,
      }),
    ).toBe(true);
  });

  it("leaves a small-file image within the resolution limit unchanged", () => {
    expect(
      shouldCompressClientImage({
        fileSize: 2.7 * BYTES_PER_MB,
        width: 1200,
        height: 1200,
      }),
    ).toBe(false);
  });

  it("downscales a high-resolution server image before storage or embedding", async () => {
    const original = await sharp({
      create: {
        width: 4000,
        height: 4000,
        channels: 3,
        background: "#456789",
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();

    expect(original.byteLength).toBeLessThan(5 * BYTES_PER_MB);

    const prepared = await prepareReferenceImageBuffer(original);
    const metadata = await sharp(prepared.buffer).metadata();

    expect(prepared.mimeType).toBe("image/jpeg");
    expect(metadata.width).toBe(REFERENCE_IMAGE_MAX_DIMENSION);
    expect(metadata.height).toBe(REFERENCE_IMAGE_MAX_DIMENSION);
  });

  it("enforces Jina byte and resolution limits for a noisy image", async () => {
    const original = await sharp(randomBytes(1600 * 1600 * 3), {
      raw: {
        width: 1600,
        height: 1600,
        channels: 3,
      },
    })
      .png()
      .toBuffer();

    expect(original.byteLength).toBeGreaterThan(JINA_IMAGE_TARGET_BYTES);

    const preparedDataUrl = await prepareJinaImageDataUrl(
      `data:image/png;base64,${original.toString("base64")}`,
    );
    const preparedBuffer = Buffer.from(preparedDataUrl.split(",")[1], "base64");
    const metadata = await sharp(preparedBuffer).metadata();

    expect(preparedBuffer.byteLength).toBeLessThanOrEqual(JINA_IMAGE_TARGET_BYTES);
    expect(metadata.width).toBeLessThanOrEqual(JINA_IMAGE_MAX_DIMENSION);
    expect(metadata.height).toBeLessThanOrEqual(JINA_IMAGE_MAX_DIMENSION);
  });

  it("keeps feature upload preparation rectangular by default", async () => {
    const original = await stripedImage(80, 229);
    const prepared = await prepareReferenceImageBuffer(original);
    expect([prepared.width, prepared.height]).toEqual([80, 229]);

    const jinaDefault = await prepareJinaImageDataUrl(
      `data:image/png;base64,${original.toString("base64")}`,
    );
    expect(jinaDefault).toBe(`data:image/jpeg;base64,${prepared.buffer.toString("base64")}`);
  });

  it.each([
    { width: 14, height: 11 },
    { width: 68, height: 182 },
    { width: 182, height: 68 },
    { width: 2000, height: 3000 },
    { width: 3000, height: 2000 },
  ])(
    "preserves both ends and proportions of a $width by $height crop on a white square",
    async ({ width, height }) => {
      const original = await stripedImage(width, height);
      const preparedDataUrl = await prepareJinaImageDataUrl(
        `data:image/png;base64,${original.toString("base64")}`,
        {
          padToSquare: true,
        },
      );
      const pixels = await readPixels(Buffer.from(preparedDataUrl.split(",")[1], "base64"));

      expect(preparedDataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect([pixels.width, pixels.height]).toEqual([
        JINA_SQUARE_IMAGE_DIMENSION,
        JINA_SQUARE_IMAGE_DIMENSION,
      ]);
      const shortSide = Math.round((512 * Math.min(width, height)) / Math.max(width, height));
      const margin = Math.floor((512 - shortSide) / 2);
      // Swapping the coordinates lets the same checks inspect portrait and landscape images.
      const at = (across: number, along: number) =>
        height > width ? pixels.at(across, along) : pixels.at(along, across);

      expectColor(at(256, 5), [255, 0, 0]);
      expectColor(at(256, 506), [0, 0, 255]);
      expectColor(at(256, 256), [0, 180, 0]);
      expectColor(at(5, 256), [255, 255, 255]);
      expectColor(at(506, 256), [255, 255, 255]);
      // Content fills the proportional rectangle, including after upscaling a tiny image.
      expectColor(at(margin + 3, 256), [0, 180, 0]);
      expectColor(at(512 - margin - 4, 256), [0, 180, 0]);
      expectColor(at(margin - 3, 256), [255, 255, 255]);
      expectColor(at(512 - margin + 2, 256), [255, 255, 255]);
    },
  );

  it("applies EXIF orientation before positioning the complete object on its square", async () => {
    const original = await sharp(await stripedImage(80, 229))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const prepared = await prepareSquareEmbeddingImageBuffer(original);
    const pixels = await readPixels(prepared);

    expect([pixels.width, pixels.height]).toEqual([512, 512]);
    expectColor(pixels.at(10, 256), [0, 0, 255]);
    expectColor(pixels.at(501, 256), [255, 0, 0]);
    expectColor(pixels.at(256, 10), [255, 255, 255]);
    expect((await sharp(prepared).metadata()).orientation).toBeUndefined();
  });

  it("extracts a product region using orientation-correct original coordinates", async () => {
    const original = await sharp(await stripedImage(80, 229))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    // After rotation the image is 229px wide, with the original top red stripe on the right.
    const prepared = await prepareSquareEmbeddingImageBuffer(original, {
      left: 210,
      top: 0,
      width: 19,
      height: 80,
    });
    const pixels = await readPixels(prepared);

    expectColor(pixels.at(256, 5), [255, 0, 0]);
    expectColor(pixels.at(256, 506), [255, 0, 0]);
    expectColor(pixels.at(5, 256), [255, 255, 255]);
  });

  it("flattens transparency onto white for both the image and padding", async () => {
    const original = await sharp({
      create: {
        width: 80,
        height: 229,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const prepared = await prepareSquareEmbeddingImageBuffer(original);
    const pixels = await readPixels(prepared);

    expectColor(pixels.at(256, 256), [255, 127, 127]);
    expectColor(pixels.at(10, 256), [255, 255, 255]);
    expect((await sharp(prepared).metadata()).channels).toBe(3);
  });

  it("does not alter decoded pixels when a prepared crop reaches Jina again", async () => {
    const original = await sharp(randomBytes(191 * 311 * 3), {
      raw: { width: 191, height: 311, channels: 3 },
    })
      .png()
      .toBuffer();
    const first = await prepareSquareEmbeddingImageBuffer(original);
    const dataUrl = await prepareJinaImageDataUrl(
      `data:image/png;base64,${first.toString("base64")}`,
      { padToSquare: true },
    );
    const second = Buffer.from(dataUrl.split(",")[1], "base64");

    const firstPixels = await sharp(first).raw().toBuffer();
    const secondPixels = await sharp(second).raw().toBuffer();
    expect(secondPixels.equals(firstPixels)).toBe(true);
  });

  it("normalizes grayscale input to three-channel sRGB", async () => {
    const original = await sharp({
      create: { width: 40, height: 80, channels: 3, background: "#808080" },
    })
      .toColourspace("b-w")
      .png()
      .toBuffer();
    expect((await sharp(original).metadata()).channels).toBe(1);

    const prepared = await prepareSquareEmbeddingImageBuffer(original);
    expect(await sharp(prepared).metadata()).toMatchObject({ channels: 3, space: "srgb" });
    expectColor((await readPixels(prepared)).at(256, 256), [128, 128, 128]);
  });

  it("bounds even noisy square output below Jina's payload limit without lossy compression", async () => {
    const originalPixels = randomBytes(512 * 512 * 3);
    const original = await sharp(originalPixels, {
      raw: { width: 512, height: 512, channels: 3 },
    })
      .png()
      .toBuffer();
    const prepared = await prepareSquareEmbeddingImageBuffer(original);
    const metadata = await sharp(prepared).metadata();

    expect(prepared.byteLength).toBeLessThan(JINA_IMAGE_TARGET_BYTES);
    expect(metadata).toMatchObject({
      width: 512,
      height: 512,
      channels: 3,
      space: "srgb",
      format: "png",
    });
    expect((await sharp(prepared).raw().toBuffer()).equals(originalPixels)).toBe(true);
  });
});
