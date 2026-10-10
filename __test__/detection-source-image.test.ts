// @vitest-environment node

import { signObjectDetectionImageUrl } from "@/lib/media-process/image-url";
import { fetchRemoteImageInput } from "@/lib/tagging/classification-image";
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
