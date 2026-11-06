// @vitest-environment node
import { uploadLocalTestFileAction } from "@/app/(tagging)/tagging/test/actions";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  upload: vi.fn().mockImplementation(async ({ objectKey }) => ({ objectKey })),
}));
vi.mock("@/app/(auth)/withAuth", () => ({ withAuth: (fn: Function) => fn({ team: { id: 42 } }) }));
vi.mock("@/app/(tagging)/queue", () => ({ enqueueTaggingTask: vi.fn() }));
vi.mock("@/lib/feature-library-server", () => ({ getServerFeatureLibraryFeatures: vi.fn() }));
vi.mock("@/musedam/assets", () => ({ syncSingleAssetFromMuseDAM: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { assetObject: { create: mocks.create } } }));
vi.mock("@/lib/s3", () => ({
  uploadS3Object: mocks.upload,
  getCachedSignedS3ObjectUrl: () => ({ signedUrl: "https://storage.test/image.jpg" }),
  getCachedBrowserS3ObjectUrl: () => ({ signedUrl: "/api/tagging/s3-object/image.jpg" }),
}));

describe("local tagging test uploads", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects an empty upload before touching storage", async () => {
    const result = await uploadLocalTestFileAction(new FormData());
    expect(result.success).toBe(false);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("decodes an image and stores a team-owned test input with worker and preview URLs", async () => {
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "sample.png", { type: "image/png" }));
    const result = await uploadLocalTestFileAction(form);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ source: "local", name: "sample.png", width: 4, height: 3 });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: 42,
        extra: expect.objectContaining({
          localTest: true,
          thumbnailAccessUrl: "https://storage.test/image.jpg",
        }),
      }),
    });
    const uploaded = mocks.upload.mock.calls[0][0];
    expect((await sharp(uploaded.body).metadata()).format).toBe("jpeg");
  });
});
