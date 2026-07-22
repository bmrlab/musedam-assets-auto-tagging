import { prepareClientImageUpload, shouldCompressClientImage } from "@/lib/brand/browser-image";
import {
  BYTES_PER_MB,
  JINA_IMAGE_MAX_DIMENSION,
  JINA_IMAGE_TARGET_BYTES,
  REFERENCE_IMAGE_MAX_DIMENSION,
} from "@/lib/brand/upload-constants";
import {
  prepareJinaImageDataUrl,
  prepareReferenceImageBuffer,
} from "@/lib/tagging/reference-image";
import { randomBytes } from "crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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
});
