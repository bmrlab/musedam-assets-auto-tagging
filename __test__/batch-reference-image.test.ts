import { REFERENCE_IMAGE_MAX_DIMENSION } from "@/lib/brand/upload-constants";
import { downloadAndPrepareBatchReferenceImage } from "@/lib/tagging/batch-reference-image";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({
  default: { lookup: mocks.lookup },
  lookup: mocks.lookup,
}));

describe("batch reference image import", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("downloads, resizes, and converts a large PNG using the manual-upload limits", async () => {
    const source = await sharp({
      create: {
        width: 1800,
        height: 1400,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(source), {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const prepared = await downloadAndPrepareBatchReferenceImage(
      "https://images.example.com/logo.png",
    );
    const metadata = await sharp(prepared.buffer).metadata();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(prepared.extension).toBe(".webp");
    expect(prepared.mimeType).toBe("image/webp");
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(REFERENCE_IMAGE_MAX_DIMENSION);
  });

  it("rejects an S3 object key instead of treating it as an import URL", async () => {
    await expect(
      downloadAndPrepareBatchReferenceImage("feature-library/teams-1-asset-logos-image.png"),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("accepts the configured stable S3 URL in local development", async () => {
    vi.stubEnv("S3_ENDPOINT_URL", "http://localhost:9002");
    vi.stubEnv("S3_BUCKET", "bucket1");
    vi.stubEnv("S3_FOLDER", "feature-library");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    const source = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: "#123456",
      },
    })
      .png()
      .toBuffer();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array(source), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const prepared = await downloadAndPrepareBatchReferenceImage(
      "http://localhost:9002/bucket1/feature-library/teams-1-asset-logos-image.png",
    );

    expect(prepared.extension).toBe(".png");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("rejects URLs that resolve to a private address", async () => {
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadAndPrepareBatchReferenceImage("https://internal.example.com/image.png"),
    ).rejects.toMatchObject({ code: "invalid_url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
