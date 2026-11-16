// @vitest-environment node
import { startTaggingTasksAction, uploadLocalTestFileAction } from "@/app/(tagging)/tagging/test/actions";
import sharp from "sharp";
import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { getServerFeatureLibraryFeatures } from "@/lib/feature-library-server";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}),
  upload: vi.fn().mockImplementation(async ({ objectKey }) => ({ objectKey })),
}));
vi.mock("@/app/(auth)/withAuth", () => ({ withAuth: (fn: (session: { team: { id: number } }) => unknown) => fn({ team: { id: 42 } }) }));
vi.mock("@/app/(tagging)/queue", () => ({ enqueueTaggingTask: vi.fn() }));
vi.mock("@/lib/feature-library-server", () => ({ getServerFeatureLibraryFeatures: vi.fn() }));
vi.mock("@/lib/media-process/video-frames", () => ({ requestVideoFrames: vi.fn() }));
vi.mock("@/musedam/assets", () => ({ syncSingleAssetFromMuseDAM: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { assetObject: { create: mocks.create }, team: { findUniqueOrThrow: async () => ({ id: 42, slug: "t/42" }) } } }));
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


describe("test task image mode snapshots", () => {
  it.each([
    ["jpg", undefined, false], ["mp4", undefined, false],
    ["jpg", false, false], ["mp4", false, false],
    ["jpg", true, true], ["mp4", true, true],
  ] as const)("passes %s test mode %s explicitly to the queue", async (extension, selected, expected) => {
    vi.mocked(getServerFeatureLibraryFeatures).mockResolvedValue({
      featureLibrary: true, featureProduct: true, featureBrand: true, featureIp: false, featurePerson: false,
    });
    vi.mocked(syncSingleAssetFromMuseDAM).mockResolvedValue({ assetObject: { id: 1, teamId: 42 } } as Awaited<ReturnType<typeof syncSingleAssetFromMuseDAM>>);
    vi.mocked(enqueueTaggingTask).mockResolvedValue({ id: 123 } as Awaited<ReturnType<typeof enqueueTaggingTask>>);
    const result = await startTaggingTasksAction(
      [{ id: "123", name: "asset", extension, size: 100 }],
      selected === undefined ? undefined : { featureImageMode: selected },
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.successCount).toBe(1);
    expect(enqueueTaggingTask).toHaveBeenLastCalledWith(expect.objectContaining({
      taskType: "test", featureImageMode: expected,
    }));
  });
});
