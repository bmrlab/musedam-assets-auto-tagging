// @vitest-environment node

import {
  classifyFeatureVideoAction,
  classifyPersonVideoAction,
  prepareClassificationVideoUploadAction,
} from "@/app/(tagging)/tagging/components/classification-video-actions";
import { tryAcquireVideoClassificationSlot } from "@/lib/feature-decision/video-classification-slot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { classifyVideo, fetchAssets, requestFrames, classifyFaces, getUploadUrl } = vi.hoisted(
  () => ({
    classifyVideo: vi.fn(),
    fetchAssets: vi.fn(),
    requestFrames: vi.fn(),
    classifyFaces: vi.fn(),
    getUploadUrl: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (callback: (session: unknown) => unknown) =>
    callback({ team: { id: 7, slug: "t/16" } }),
}));
vi.mock("@/lib/feature-decision/video-classification", () => ({
  classifyVideoAssetFeatures: classifyVideo,
}));
vi.mock("@/lib/media-process/video-frames", () => ({ requestVideoFrames: requestFrames }));
vi.mock("@/lib/person/person-classification", () => ({
  detectPersonFaceBoxes: vi.fn().mockResolvedValue({ detections: [] }),
  classifyPersonFaceEmbeddings: classifyFaces,
}));
vi.mock("@/lib/tagging/classification-image", () => ({
  fetchRemotePersonImageInput: vi.fn().mockResolvedValue({ dataUrl: "frame-image" }),
}));
vi.mock("@/lib/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3")>()),
  getBrowserS3ObjectUploadUrl: getUploadUrl,
  getCachedSignedS3ObjectUrl: () => ({ signedUrl: "https://storage.example/video.mp4" }),
}));
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: vi.fn().mockResolvedValue({ apiKey: "team-key" }),
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: fetchAssets }));

describe("classification video inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs two video classifications sequentially and releases the slot after a failure", async () => {
    const firstStarted = Promise.withResolvers<void>();
    const firstResult = Promise.withResolvers<never>();
    classifyVideo
      .mockImplementationOnce(() => {
        firstStarted.resolve();
        return firstResult.promise;
      })
      .mockResolvedValueOnce({ product: { topMatches: [] } });
    const input = {
      source: {
        kind: "local" as const,
        objectKey: "teams-7-classification-video-66bd89a9-84d9-4f82-8ad5-036d03013dab.mp4",
      },
      featureType: "product" as const,
      imageMode: false,
      fileName: "first.mp4",
      folderPath: "",
    };

    const first = classifyFeatureVideoAction(input);
    await firstStarted.promise;
    const second = classifyFeatureVideoAction({ ...input, fileName: "second.mp4" });
    await Promise.resolve();
    expect(classifyVideo).toHaveBeenCalledOnce();
    expect(tryAcquireVideoClassificationSlot()).toBeUndefined();

    firstResult.reject(new Error("First video failed"));
    await expect(first).resolves.toMatchObject({ success: false });
    await expect(second).resolves.toMatchObject({ success: true });
    expect(classifyVideo).toHaveBeenCalledTimes(2);
  });

  it("uploads a local video with a team-scoped key and reuses that key for classification", async () => {
    getUploadUrl.mockReturnValue({ signedUrl: "https://storage.example/upload" });
    classifyVideo.mockResolvedValue({ brand: { topMatches: [] } });
    const upload = await prepareClassificationVideoUploadAction({
      name: "Clip.MP4",
      mimeType: "video/mp4",
      size: 15 * 1024 * 1024,
    });
    expect(upload.success).toBe(true);
    if (!upload.success) return;
    expect(upload.data.objectKey).toMatch(/teams-7-classification-video-.*\.mp4$/);
    const result = await classifyFeatureVideoAction({
      source: { kind: "local", objectKey: upload.data.objectKey },
      featureType: "logo",
      imageMode: true,
      fileName: "Clip.MP4",
      folderPath: "",
    });
    expect(result.success).toBe(true);
    expect(classifyVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 7,
        videoUrl: "https://storage.example/video.mp4",
        enabledTypes: ["logo"],
        imageMode: true,
      }),
    );
  });

  it("uses the current team's MuseDAM credentials and original video URL for imports", async () => {
    fetchAssets.mockResolvedValue([
      {
        id: "12345678901234567890",
        name: "Clip.mov",
        extension: "mov",
        downloadUrl: "https://musedam.example/original.mov",
        thumbnailAccessUrl: "https://musedam.example/thumbnail.jpg",
      },
    ]);
    await classifyFeatureVideoAction({
      source: { kind: "musedam", assetId: "12345678901234567890" },
      featureType: "ip",
      imageMode: false,
      fileName: "Clip.mov",
      folderPath: "Campaign",
    });
    expect(fetchAssets).toHaveBeenCalledWith(
      "/api/muse/assets-by-ids",
      expect.objectContaining({
        headers: { Authorization: "Bearer team-key" },
      }),
    );
    expect(JSON.stringify(fetchAssets.mock.calls[0][1].body)).toBe('["12345678901234567890"]');
    expect(classifyVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrl: "https://musedam.example/original.mov",
        enabledTypes: ["ip"],
        imageMode: false,
        folderPath: "Campaign",
      }),
    );
  });

  it("rejects another team's upload and extracts just the first frame for local person videos", async () => {
    const objectKey = "teams-7-classification-video-66bd89a9-84d9-4f82-8ad5-036d03013dab.mp4";
    const other = await classifyPersonVideoAction({
      kind: "local",
      objectKey: objectKey.replace("teams-7", "teams-8"),
    });
    expect(other.success).toBe(false);
    expect(requestFrames).not.toHaveBeenCalled();

    requestFrames.mockResolvedValue([{ url: "https://storage.example/frame.jpg", timestamp: 0 }]);
    classifyFaces.mockResolvedValue({ faces: [] });
    expect(await classifyPersonVideoAction({ kind: "local", objectKey })).toEqual({
      success: true,
      data: { result: { faces: [] }, detections: [] },
    });
    expect(requestFrames).toHaveBeenCalledWith(
      7,
      "https://storage.example/video.mp4",
      expect.any(AbortSignal),
      1,
    );
  });
});
