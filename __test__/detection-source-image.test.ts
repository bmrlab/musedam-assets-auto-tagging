// @vitest-environment node

import { signObjectDetectionImageUrl } from "@/lib/media-process/image-url";
import { cropProductImageToDataUrl } from "@/lib/product/image-preparation";
import {
  cropImageToDataUrl,
  fetchRemoteImageInput,
  prepareSvgCropSource,
} from "@/lib/tagging/classification-image";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logging", () => ({ rootLogger: { warn: vi.fn(), info: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("remote detection image coordinates", () => {
  it("uses the saved JPEG preview coordinates for an SVG IP partial-reference crop", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="200" height="200" fill="red"/><rect x="200" width="200" height="200" fill="green"/></svg>',
    );
    const source = await prepareSvgCropSource(svg, "image/svg+xml", { width: 200, height: 100 });
    expect(source.mimeType).toBe("image/jpeg");
    expect(await sharp(source.buffer).metadata()).toMatchObject({ width: 200, height: 100 });
    const crop = await cropImageToDataUrl({
      imageDataUrl: `data:image/jpeg;base64,${source.buffer.toString("base64")}`,
      imageBuffer: source.buffer,
      sourceMimeType: source.mimeType,
      meta: { width: 200, height: 100 },
      box: { xMin: 110, yMin: 10, xMax: 190, yMax: 90, score: 1, label: "character" },
    });
    const pixel = await sharp(Buffer.from(crop.split(",")[1], "base64"))
      .extract({ left: 40, top: 40, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(pixel[1]).toBeGreaterThan(pixel[0] * 2);
  });

  it("rasterizes SVG bytes once and uses JPEG pixels for previews and product crops", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 87.5 57"><rect width="43.75" height="57" fill="#ff0000"/></svg>',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(svg), {
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    );
    const url = "https://assets.test/image.svg?signature=preserved";
    const input = await fetchRemoteImageInput(url, "SVG detection", { preserveOriginal: true });
    expect(input.sourceImage).toEqual({ url, width: 88, height: 57, isSvg: true });
    expect(input.mimeType).toBe("image/jpeg");
    expect(input.original?.mimeType).toBe("image/jpeg");
    expect(input.width).toBe(1280);
    expect(input.height).toBeGreaterThan(800);
    expect(input.original?.width).toBe(2048);
    expect(input.original?.height).toBeGreaterThan(1300);
    expect((await sharp(input.buffer).metadata()).format).toBe("jpeg");
    const crop = await cropProductImageToDataUrl({
      imageInput: input,
      box: { xMin: 0, yMin: 0, xMax: input.width / 2, yMax: input.height },
    });
    expect((await sharp(Buffer.from(crop.split(",")[1], "base64")).metadata()).format).toBe("png");
  });

  it.each([
    {
      width: 6400,
      height: 3600,
      orientation: 1,
      remote: [6400, 3600],
      preview: [1280, 720],
      working: [4096, 2304],
    },
    {
      width: 2400,
      height: 1600,
      orientation: 6,
      remote: [1600, 2400],
      preview: [853, 1280],
      working: [1600, 2400],
    },
    {
      width: 120,
      height: 80,
      orientation: 1,
      remote: [120, 80],
      preview: [120, 80],
      working: [120, 80],
    },
  ])(
    "retains remote dimensions across resizing and EXIF rotation: $width x $height",
    async (test) => {
      const bytes = await sharp({
        create: { width: test.width, height: test.height, channels: 3, background: "#456789" },
      })
        .withMetadata({ orientation: test.orientation })
        .jpeg()
        .toBuffer();
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }),
        ),
      );
      const url = "https://assets.test/image.jpg?signature=preserved";
      const input = await fetchRemoteImageInput(url, "detection", { preserveOriginal: true });
      expect(input.sourceImage).toEqual({ url, width: test.remote[0], height: test.remote[1] });
      expect([input.width, input.height]).toEqual(test.preview);
      expect([input.original?.width, input.original?.height]).toEqual(test.working);
      expect((await sharp(input.buffer).metadata()).orientation).toBeUndefined();
    },
  );
});

it("creates fresh seven-day direct S3 URLs even in local development", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  for (const [key, value] of Object.entries({
    AWS_ACCESS_KEY_ID: "test-access-key",
    AWS_SECRET_ACCESS_KEY: "test-secret-key",
    S3_BUCKET: "images",
    S3_ENDPOINT_URL: "https://s3.test",
    S3_REGION: "us-east-1",
    S3_FORCE_PATH_STYLE: "true",
    LOCAL_DEV: "true",
  }))
    vi.stubEnv(key, value);
  const first = signObjectDetectionImageUrl("image.jpg");
  vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  const second = signObjectDetectionImageUrl("image.jpg");
  const url = new URL(second.signedUrl);
  expect(url.origin).toBe("https://s3.test");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("604800");
  expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  expect(second.signedUrl).not.toBe(first.signedUrl);
  expect(second.signedUrlExpiresAt - Date.now()).toBe(7 * 24 * 60 * 60 * 1000);
});
