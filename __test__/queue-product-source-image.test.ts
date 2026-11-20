import { queueSleep } from "@/lib/tagging/queue-execution";
// @vitest-environment node

import { enqueueTaggingTask, processQueueItem } from "@/app/(tagging)/queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRetry: vi.fn(),
  product: vi.fn(),
  brand: vi.fn(),
  ip: vi.fn(),
  fetchSource: vi.fn(),
  prepare: vi.fn(),
  productCount: vi.fn(),
  brandCount: vi.fn(),
  ipCount: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  classifyFeatures: vi.fn(),
  classifyVideo: vi.fn(),
  prepareVideo: vi.fn(),
  buildRecommendations: vi.fn(),
  predict: vi.fn(),
  mode: "legacy" as "llm" | "legacy",
  imageMode: false,
  videoImageMode: false,
  tagsTree: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/(tagging)/tagging/review/feature-retry-worker", () => ({ saveFeatureRetry: mocks.saveRetry }));
vi.mock("@/lib/tagging/refresh-asset", () => ({ refreshQueuedAsset: async (_teamId: number, asset: unknown) => asset }));
vi.mock("@/lib/product/tagging-product-classification", () => ({
  classifyAssetProductRecommendation: mocks.product,
}));
vi.mock("@/lib/brand/tagging-brand-classification", () => ({
  classifyAssetBrandRecommendation: mocks.brand,
}));
vi.mock("@/lib/ip/tagging-ip-classification", () => ({
  classifyAssetIpRecommendation: mocks.ip,
}));
vi.mock("@/lib/feature-decision/classify", () => ({
  classifyAssetFeatures: mocks.classifyFeatures,
  getFeatureDecisionMode: () => mocks.mode,
}));
vi.mock("@/lib/feature-decision/video-classification", () => ({
  classifyVideoAssetFeatures: mocks.classifyVideo,
  prepareVideoAssetEvidence: mocks.prepareVideo,
}));
vi.mock("@/lib/feature-decision/recommendations", () => ({
  buildFeatureRecommendations: mocks.buildRecommendations,
}));
vi.mock("@/lib/tagging/classification-image", () => ({
  fetchRemoteImageSource: mocks.fetchSource,
  prepareImageInput: mocks.prepare,
  isImageTooLargeError: (error: unknown) =>
    error instanceof Error && error.message === "image too large",
}));
vi.mock("@/app/(tagging)/predict", () => ({
  predictAssetTags: mocks.predict,
}));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({
  getTaggingSettings: async () => ({ sourceWeights: {}, featureImageMode: mocks.imageMode, featureVideoImageMode: mocks.videoImageMode }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $transaction: async (run: (db: unknown) => unknown) =>
      run({
        $queryRaw: vi.fn(),
        teamConfig: { findUnique: async () => null },
        taggingQueueItem: { create: mocks.create },
      }),
    team: { findUniqueOrThrow: async () => ({ id: 7, slug: "team" }) },
    teamConfig: { findUnique: async () => null },
    productVector: { count: mocks.productCount },
    logoVector: { count: mocks.brandCount },
    ipVector: { count: mocks.ipCount },
    taggingQueueItem: { create: mocks.create, update: mocks.update, findUnique: mocks.findUnique },
  },
}));
vi.mock("@/lib/logging", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { rootLogger: logger };
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.videoImageMode = false;
  mocks.tagsTree = [];
  vi.stubEnv("DECISION_LLM_IMAGE_USE", "false");
  // These source-selection regressions exercise the explicitly configured old flow.
  mocks.mode = "legacy";
  mocks.imageMode = false;
  mocks.productCount.mockResolvedValue(1);
  mocks.brandCount.mockResolvedValue(1);
  mocks.ipCount.mockResolvedValue(1);
  mocks.product.mockResolvedValue(null);
  mocks.brand.mockResolvedValue(null);
  mocks.ip.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(null);
  mocks.update.mockResolvedValue({});
  mocks.predict.mockResolvedValue({ predictions: {}, tagsWithScore: [], usage: {}, extra: {} });
  mocks.classifyFeatures.mockResolvedValue({
    brand: null,
    ip: null,
    product: null,
    diagnostics: {
      mode: "llm",
      ocr: { status: "completed", segments: ["雅诗兰黛"] },
      decision: { status: "completed", result: { outcome: "no_match", matches: [] } },
    },
  });
  mocks.classifyVideo.mockImplementation(() => mocks.classifyFeatures.getMockImplementation()?.());
  mocks.buildRecommendations.mockResolvedValue({
    brandRecommendation: null,
    ipRecommendation: null,
    productRecommendation: null,
  });
  mocks.fetchSource.mockImplementation(async (url: string) => ({
    imageUrl: url,
    buffer: Buffer.from("image"),
    mimeType: "image/jpeg",
  }));
  mocks.prepare.mockImplementation(async (source: { imageUrl: string }) => ({
    sourceImage: { url: source.imageUrl, width: 100, height: 100 },
    dataUrl: source.imageUrl,
  }));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function run(
  extra: Record<string, unknown>,
  features: { brand?: boolean; product?: boolean; ip?: boolean } = {
    brand: true,
    product: true,
    ip: true,
  },
  snapshot?: boolean,
  retrySourceId?: number,
  inPlace = false,
) {
  await processQueueItem({
    id: 1,
    teamId: 7,
    taskType: "test",
    assetObjectId: 2,
    startsAt: new Date("2026-11-16T00:00:00.000Z"),
    result: inPlace ? { tagsWithScore: [{ leafTagId: 99 }], metadataPredictions: ["kept"] } : {},
    extra: {
      ...(inPlace ? { featureRetryInPlace: true } : {}),
      ...(retrySourceId ? { featureRetrySourceQueueItemId: retrySourceId } : {}),
      ...(snapshot === undefined ? {} : { featureImageMode: snapshot, creditCost: snapshot ? 2 : 1 }),
      featureClassify: true,
      featureBrand: features.brand ?? false,
      featureProduct: features.product ?? false,
      featurePerson: false,
      featureIp: features.ip ?? false,
    },
    assetObject: {
      id: 2,
      teamId: 7,
      slug: "test",
      name: "雅诗兰黛小棕瓶系列.jpg",
      materializedPath: "/产品/雅诗兰黛",
      extra,
    },
    tagsTreeLoader: async () => mocks.tagsTree,
  } as unknown as Parameters<typeof processQueueItem>[0]);
}

describe("legacy automatic object detection source selection", () => {
  it("shares the exact download URL and prepared input across logo, IP, and product", async () => {
    const downloadUrl = "https://example.test/image.tif?disposition=attachment";
    await run({
      extension: "tif",
      downloadUrl,
      thumbnailAccessUrl: "https://example.test/image.jpeg?disposition=inline",
    });

    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(
      downloadUrl,
      "feature classification",
    );
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ imageUrl: downloadUrl }),
      "feature classification",
      { preserveOriginal: true },
    );
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify.mock.calls[0][0].imageInput.sourceImage.url).toBe(downloadUrl);
    }
    expect(mocks.brand.mock.calls[0][0].imageInput).toBe(mocks.product.mock.calls[0][0].imageInput);
  });

  it("uses the download URL even when the thumbnail points to the same object", async () => {
    const downloadUrl = "https://example.test/image.png?disposition=attachment";
    await run({
      extension: "png",
      downloadUrl,
      thumbnailAccessUrl: "https://example.test/image.png?disposition=inline",
    });
    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(
      downloadUrl,
      "feature classification",
    );
    expect(mocks.brand.mock.calls[0][0].imageInput.sourceImage.url).toBe(downloadUrl);
  });

  it("passes the original video, saved image mode and existing OCR to the frame classifier", async () => {
    mocks.mode = "llm";
    await run({
      extension: "mp4",
      downloadUrl: "https://example.test/video.mp4",
      thumbnailAccessUrl: "https://example.test/frame.jpg",
      ocrContent: ["Video OCR"],
    }, undefined, true);
    expect(mocks.classifyVideo).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        videoUrl: "https://example.test/video.mp4",
        signal: expect.any(AbortSignal),
        imageMode: true,
        ocrSegments: ["Video OCR"],
      }),
    );
    expect(mocks.fetchSource).not.toHaveBeenCalled();
  });

  it("uses the download URL when no thumbnail exists", async () => {
    const downloadUrl = "https://example.test/original.png";
    await run({ extension: "png", downloadUrl });
    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(
      downloadUrl,
      "feature classification",
    );
    expect(mocks.brand.mock.calls[0][0].imageInput.sourceImage.url).toBe(downloadUrl);
  });

  it("uses the thumbnail when the download URL is missing", async () => {
    const thumbnailUrl = "https://example.test/thumbnail.jpg";
    await run({ extension: "jpg", thumbnailAccessUrl: thumbnailUrl });
    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(thumbnailUrl, "task thumbnail");
    expect(mocks.product.mock.calls[0][0].imageInput.sourceImage.url).toBe(thumbnailUrl);
  });

  it("falls back to the thumbnail for all classifiers when the original is too large", async () => {
    const downloadUrl = "https://example.test/original.tif";
    const thumbnailUrl = "https://example.test/thumbnail.jpg";
    mocks.fetchSource.mockImplementation(async (url: string) => {
      if (url === downloadUrl) throw new Error("image too large");
      return { imageUrl: url, buffer: Buffer.from("image"), mimeType: "image/jpeg" };
    });
    await run({ extension: "tif", downloadUrl, thumbnailAccessUrl: thumbnailUrl });
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify.mock.calls[0][0].imageInput.sourceImage.url).toBe(thumbnailUrl);
    }
  });

  it("does not fetch images for empty feature libraries", async () => {
    mocks.productCount.mockResolvedValue(0);
    mocks.brandCount.mockResolvedValue(0);
    mocks.ipCount.mockResolvedValue(0);
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });
    expect(mocks.fetchSource).not.toHaveBeenCalled();
  });
});

describe("expired original image fallback", () => {
  it.each(["legacy", "llm"] as const)("uses a working thumbnail after an original download fails in %s mode", async (mode) => {
    mocks.mode = mode;
    const downloadUrl = "https://example.test/original.png?Expires=1787923131";
    const thumbnailUrl = "https://example.test/thumbnail.jpg";
    mocks.fetchSource.mockImplementation(async (url: string) => {
      if (url === downloadUrl) throw new Error("HTTP 403: signed URL expired");
      return { imageUrl: url, buffer: Buffer.from("image"), mimeType: "image/jpeg" };
    });

    await run({ extension: "png", downloadUrl, thumbnailAccessUrl: thumbnailUrl });

    expect(mocks.fetchSource).toHaveBeenCalledWith(thumbnailUrl, "task thumbnail");
    for (const classify of mode === "llm"
      ? [mocks.classifyFeatures]
      : [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify).toHaveBeenCalledWith(
        expect.objectContaining({ imageInput: expect.objectContaining({ dataUrl: thumbnailUrl }) }),
      );
    }
  });

  it("does not repeatedly retry the same failed source when the thumbnail URL is identical", async () => {
    mocks.mode = "llm";
    mocks.fetchSource.mockRejectedValue(new Error("HTTP 403"));
    const url = "https://example.test/expired.jpg";
    await run({ extension: "jpg", downloadUrl: url, thumbnailAccessUrl: url });
    expect(mocks.fetchSource).toHaveBeenCalledTimes(1);
    expect(mocks.classifyFeatures).not.toHaveBeenCalled();
  });
});

describe("combined LLM feature classification", () => {
  it.each([false, true])("uses the team's image mode setting (%s) for queued feature recognition", async enabled => {
    mocks.mode = "llm";
    mocks.imageMode = enabled;
    await run({ extension: "jpg", downloadUrl: "https://example.test/image.jpg" });
    expect(mocks.classifyFeatures).toHaveBeenCalledWith(expect.objectContaining({ teamId: 7, imageMode: enabled }));
  });

  beforeEach(() => {
    mocks.mode = "llm";
  });

  it("pools all enabled feature types into one call with the same prepared source and asset context", async () => {
    const downloadUrl = "https://example.test/original.tif?disposition=attachment";
    await run({
      extension: "tif",
      downloadUrl,
      thumbnailAccessUrl: "https://example.test/preview.jpg",
    });

    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(
      downloadUrl,
      "feature classification",
    );
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ imageUrl: downloadUrl }),
      "feature classification",
      { preserveOriginal: true },
    );
    const preparedSource = await mocks.prepare.mock.results[0].value;
    expect(mocks.classifyFeatures).toHaveBeenCalledExactlyOnceWith({
      onOcr: expect.any(Function),
      onProgress: expect.any(Function),
      allowTextFallback: true,
      teamId: 7,
      queueItemId: 1,
      assetObjectId: 2,
      fileName: "雅诗兰黛小棕瓶系列.jpg",
      folderPath: "/产品/雅诗兰黛",
      imageMode: false,
      mode: "llm",
      imageInput: preparedSource,
      ocrImage: undefined,
      ocrSegments: [],
      enabledTypes: ["logo", "product", "ip"],
    });
    expect(mocks.classifyFeatures.mock.calls[0][0].imageInput).toBe(preparedSource);
    const classification = await mocks.classifyFeatures.mock.results[0].value;
    expect(mocks.buildRecommendations).toHaveBeenCalledExactlyOnceWith(classification);
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify).not.toHaveBeenCalled();
    }
  });

  it("uses the team setting even when the old environment flag enables image mode", async () => {
    vi.stubEnv("DECISION_LLM_IMAGE_USE", "true");
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });

    expect(mocks.classifyFeatures).toHaveBeenCalledWith(
      expect.objectContaining({ imageMode: false }),
    );
  });

  it("includes only enabled feature libraries with available reference vectors", async () => {
    mocks.productCount.mockResolvedValue(0);
    await run(
      { extension: "jpg", downloadUrl: "https://example.test/original.jpg" },
      { brand: true, product: true, ip: false },
    );

    expect(mocks.classifyFeatures).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ enabledTypes: ["logo"] }),
    );
    expect(mocks.ipCount).not.toHaveBeenCalled();
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify).not.toHaveBeenCalled();
    }
  });

  it("does not promote embedding recommendations when the combined classifier fails", async () => {
    mocks.classifyFeatures.mockRejectedValue(new Error("decision source unavailable"));
    mocks.predict.mockResolvedValue({
      predictions: {},
      tagsWithScore: [
        {
          leafTagId: 99,
          tagPath: ["Generic scene"],
          confidenceBySources: { basicInfo: 0.9 },
          score: 90,
        },
      ],
      usage: {},
      extra: {},
    });
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });

    expect(mocks.classifyFeatures).toHaveBeenCalledTimes(1);
    expect(mocks.buildRecommendations).not.toHaveBeenCalled();
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify).not.toHaveBeenCalled();
    }
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          result: expect.objectContaining({
            error: "FEATURE_RECOGNITION_FAILED",
            featureDecision: expect.objectContaining({
              mode: "llm",
              decision: expect.objectContaining({ status: "failed" }),
            }),
          }),
        }),
      }),
    );
  });

  it.each(["budget", "jina"])("retains ordinary predictions after %s degradation and marks features incomplete", async reason => {
    mocks.mode = "llm";
    mocks.predict.mockResolvedValue({ predictions: {}, tagsWithScore: [{
      leafTagId: 99, tagPath: ["Scene"], confidenceBySources: { basicInfo: 0.9 }, score: 90,
    }], usage: {}, extra: {} });
    if (reason === "budget") {
      vi.useFakeTimers();
      mocks.classifyFeatures.mockImplementation(input => {
        input.onOcr?.({ status: "completed", segments: ["Product name"], source: "model" });
        return queueSleep(200_000);
      });
    } else {
      mocks.classifyFeatures.mockResolvedValue({ brand: null, product: null, ip: null, diagnostics: {
        mode: "llm", ocr: { status: "completed", segments: ["Product name"], source: "musedam" },
        retrieval: { errors: ["product retrieval: JINA_UNAVAILABLE: timeout"] },
        decision: { status: "failed", error: "Jina unavailable" },
      } });
    }
    const task = run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });
    if (reason === "budget") await vi.advanceTimersByTimeAsync(150_001);
    await task;
    expect(mocks.buildRecommendations).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "completed", result: expect.objectContaining({
        outputTypes: expect.objectContaining({ features: false }),
        tagsWithScore: expect.arrayContaining([expect.objectContaining({ leafTagId: 99 })]),
        featureDecision: expect.objectContaining({
          degradation: expect.objectContaining({ reason: reason === "budget" ? "budget_exceeded" : "jina_unavailable" }),
          ocr: expect.objectContaining({ status: "completed", segments: ["Product name"] }),
          decision: expect.objectContaining({ status: "failed" }),
        }),
      }),
    }) }));
  });

  it("preserves completed feature diagnostics when no tags are available", async () => {
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          result: expect.objectContaining({
            error: "NO_VALID_TAGS",
            featureDecision: expect.objectContaining({
              decision: expect.objectContaining({ status: "completed" }),
            }),
          }),
        }),
      }),
    );
  });

  it("waits for feature diagnostics when general prediction rejects first", async () => {
    mocks.predict.mockRejectedValue(new Error("general tagging unavailable"));
    mocks.classifyFeatures.mockImplementation(async () => {
      await Promise.resolve();
      return {
        brand: null,
        ip: null,
        product: null,
        diagnostics: {
          mode: "llm",
          ocr: { status: "empty", segments: [] },
          decision: { status: "completed", result: { outcome: "no_match", matches: [] } },
        },
      };
    });
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });
    expect(mocks.buildRecommendations).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          result: expect.objectContaining({
            featureDecision: expect.objectContaining({
              decision: expect.objectContaining({ status: "completed" }),
            }),
          }),
        }),
      }),
    );
  });
});


describe("queued image mode snapshot", () => {
  it("captures immutable duration billing fields for videos", async () => {
    vi.useFakeTimers();
    mocks.create.mockImplementation(async ({ data }) => ({ id: 123, ...data }));
    const task = await enqueueTaggingTask({ assetObject: { id: 2, teamId: 7, extra: { extension: "mp4", duration: 5000 } } as never, featureImageMode: true });
    expect(task.extra).toMatchObject({ featureImageMode: true, creditCost: 6, creditFrameCount: 3, creditDurationMs: 5000, creditPricingVersion: "video-duration-v2" });
  });
  it.each([false, true])("keeps the enqueue mode %s after the team setting changes", async snapshot => {
    mocks.mode = "llm";
    mocks.imageMode = !snapshot;
    await run({ extension: "jpg", downloadUrl: "https://example.test/image.jpg" }, undefined, snapshot);
    expect(mocks.classifyFeatures).toHaveBeenCalledWith(expect.objectContaining({ imageMode: snapshot }));
  });

  it.each([false, true])("captures team mode %s and price for all enqueue callers", async enabled => {
    vi.useFakeTimers();
    mocks.imageMode = enabled;
    mocks.create.mockImplementation(async ({ data }) => ({ id: 123, ...data }));
    const task = await enqueueTaggingTask({ assetObject: { id: 2, teamId: 7, name: "test.jpg", extra: { extension: "jpg" } } as never });
    expect(task.extra).toMatchObject({ featureImageMode: enabled, creditCost: enabled ? 2 : 1 });
  });

  it("uses the API snapshot even when the team setting changes before creation", async () => {
    vi.useFakeTimers();
    mocks.imageMode = false;
    mocks.create.mockImplementation(async ({ data }) => ({ id: 123, ...data }));
    const task = await enqueueTaggingTask({ assetObject: { id: 2, teamId: 7, name: "test.jpg", extra: { extension: "jpg" } } as never, featureImageMode: true });
    expect(task.extra).toMatchObject({ featureImageMode: true, creditCost: 2 });
  });
});

describe("independent video team image mode", () => {
  it.each([false, true])("keeps saved video mode %s after team settings change", async snapshot => {
    mocks.mode = "llm";
    mocks.imageMode = !snapshot;
    mocks.videoImageMode = !snapshot;
    await run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4" }, undefined, snapshot);
    expect(mocks.classifyVideo).toHaveBeenCalledWith(expect.objectContaining({ imageMode: snapshot }));
  });
  it.each([false, true])("uses video setting %s for historical videos without snapshots", async enabled => {
    mocks.mode = "llm";
    mocks.imageMode = !enabled;
    mocks.videoImageMode = enabled;
    await run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4" });
    expect(mocks.classifyVideo).toHaveBeenCalledWith(expect.objectContaining({ imageMode: enabled }));
  });
  it.each([false, true])("captures video mode %s and its price independently of image mode", async enabled => {
    vi.useFakeTimers();
    mocks.imageMode = !enabled;
    mocks.videoImageMode = enabled;
    mocks.create.mockImplementation(async ({ data }) => ({ id: 123, ...data }));
    const task = await enqueueTaggingTask({ assetObject: { id: 2, teamId: 7, extra: { extension: "mp4", duration: 5000 } } as never });
    expect(task.extra).toMatchObject({ featureImageMode: enabled, creditCost: enabled ? 6 : 1, creditFrameCount: enabled ? 3 : 1 });
  });
});

describe("video feature work admission", () => {
  it.each(["disabled", "empty"])("does not sample video for %s libraries", async scenario => {
    mocks.mode = "llm";
    if (scenario === "empty") {
      mocks.productCount.mockResolvedValue(0);
      mocks.brandCount.mockResolvedValue(0);
      mocks.ipCount.mockResolvedValue(0);
    }
    await run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4", thumbnailAccessUrl: "https://example.test/thumb.jpg" },
      scenario === "empty" ? { brand: true, product: true, ip: true } : { brand: false, product: false, ip: false });
    expect(mocks.classifyVideo).not.toHaveBeenCalled();
    expect(mocks.classifyFeatures).not.toHaveBeenCalled();
    expect(mocks.fetchSource).not.toHaveBeenCalled();
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });
  it("starts ordinary prediction only once when video feature matching is enabled", async () => {
    mocks.mode = "llm";
    await run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4" });
    expect(mocks.classifyVideo).toHaveBeenCalledTimes(1);
    expect(mocks.predict).toHaveBeenCalledTimes(1);
  });
});

it("feature-only retry bypasses ordinary prediction and merges into the original batch", async () => {
  mocks.mode = "llm";
  await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" }, { brand: true }, undefined, 50);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(mocks.saveRetry).toHaveBeenCalledWith(7, 50, 1, expect.objectContaining({ featureDecision: expect.objectContaining({ decision: expect.objectContaining({ status: "completed" }) }) }), undefined);
});
it("does not merge a failed feature-only retry into the source", async () => {
  mocks.mode = "llm";
  mocks.classifyFeatures.mockRejectedValue(Error("unavailable"));
  await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" }, { brand: true }, undefined, 50);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(mocks.saveRetry).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
});

it("retains the original tags and metadata when an in-place feature retry fails", async () => {
  mocks.mode = "llm";
  mocks.classifyFeatures.mockRejectedValue(Error("unavailable"));
  await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" }, { brand: true }, undefined, 1, true);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "failed", result: expect.objectContaining({ tagsWithScore: [{ leafTagId: 99 }], metadataPredictions: ["kept"] }),
  }) }));
});
it("saves in-place feature evidence against the current execution of the original task", async () => {
  mocks.mode = "llm";
  await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" }, { brand: true }, undefined, 1, true);
  expect(mocks.saveRetry).toHaveBeenCalledWith(7, 1, 1, expect.any(Object), "2026-11-16T00:00:00.000Z");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("allows image-mode videos past the former 240s cutoff and keeps one classification pass", async () => {
  vi.useFakeTimers();
  mocks.mode = "llm";
  mocks.predict.mockResolvedValue({ predictions: {}, tagsWithScore: [{
    leafTagId: 99, tagPath: ["Scene"], confidenceBySources: { basicInfo: 0.9 }, score: 90,
  }], extra: {} });
  const classified = await mocks.classifyFeatures();
  mocks.classifyVideo.mockImplementation(async input => {
    input.onProgress?.("retrieval");
    await queueSleep(260_000);
    return classified;
  });
  const task = run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4" }, { brand: true }, true);
  await vi.advanceTimersByTimeAsync(240_001);
  expect(mocks.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20_000);
  await task;
  expect(mocks.classifyVideo).toHaveBeenCalledOnce();
  expect(mocks.classifyVideo).toHaveBeenCalledWith(expect.objectContaining({ allowTextFallback: true }));
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "completed", result: expect.objectContaining({ outputTypes: expect.objectContaining({ features: true }) }),
  }) }));
});
it("accepts successful text fallback without treating the failed image attempt as failed features", async () => {
  mocks.mode = "llm";
  mocks.predict.mockResolvedValue({ predictions: {}, tagsWithScore: [{
    leafTagId: 99, tagPath: ["Scene"], confidenceBySources: { basicInfo: 0.9 }, score: 90,
  }], extra: {} });
  const classified = await mocks.classifyFeatures();
  classified.diagnostics.decisionInputMode = "text";
  classified.diagnostics.imageFallback = { used: true, reason: "timeout", imageDecision: { status: "failed", error: "timeout" } };
  mocks.classifyFeatures.mockResolvedValue(classified);
  await run({ extension: "jpg", downloadUrl: "https://example.test/image.jpg" }, { brand: true }, true);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "completed", result: expect.objectContaining({ outputTypes: expect.objectContaining({ features: true }),
      featureDecision: expect.objectContaining({ decisionInputMode: "text", imageFallback: expect.objectContaining({ used: true }) }),
    }),
  }) }));
});


describe("ordinary tags use the image mode snapshot", () => {
  it.each([false, true])("honors image snapshot %s independently of current settings", async snapshot => {
    mocks.imageMode = !snapshot;
    await run({ extension: "gif", downloadUrl: "https://example.test/source.gif" }, { brand: false, product: false, ip: false }, snapshot);
    expect(Boolean(mocks.predict.mock.calls[0][1].loadImage)).toBe(snapshot);
  });

  it("loads an image with no feature library and no smart analysis", async () => {
    mocks.predict.mockImplementation(async (_asset, options) => {
      expect(await options.loadImage()).toBe("https://example.test/source.gif");
      return { predictions: [], tagsWithScore: [], extra: {} };
    });
    await run({ extension: "gif", downloadUrl: "https://example.test/source.gif" }, { brand: false, product: false, ip: false }, true);
    expect(mocks.fetchSource).toHaveBeenCalledTimes(1);
    expect(mocks.classifyFeatures).not.toHaveBeenCalled();
  });

  it("shares a single downloaded and decoded image with feature matching", async () => {
    mocks.mode = "llm";
    mocks.predict.mockImplementation(async (_asset, options) => {
      await options.loadImage();
      return { predictions: [], tagsWithScore: [], extra: {} };
    });
    await run({ extension: "jpg", downloadUrl: "https://example.test/image.jpg" }, undefined, true);
    expect(mocks.fetchSource).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.classifyFeatures).toHaveBeenCalledTimes(1);
  });

  it("samples video once for ordinary tags and feature matching", async () => {
    mocks.mode = "llm";
    const video = { sourceImage: "data:image/jpeg;base64,frames", frames: [], sheetColumns: 1 };
    mocks.prepareVideo.mockResolvedValue({ video, sampling: {} });
    mocks.predict.mockImplementation(async (_asset, options) => {
      expect(await options.loadImage()).toBe(video.sourceImage);
      return { predictions: [], tagsWithScore: [], extra: {} };
    });
    mocks.classifyVideo.mockImplementation(async options => {
      expect((await options.prepareVideo()).video).toBe(video);
      return mocks.classifyFeatures.getMockImplementation()?.();
    });
    await run({ extension: "mp4", downloadUrl: "https://example.test/video.mp4" }, undefined, true);
    expect(mocks.prepareVideo).toHaveBeenCalledTimes(1);
    expect(mocks.classifyVideo).toHaveBeenCalledTimes(1);
  });
});


it("completes using deterministic dimensions when ordinary prediction is empty", async () => {
  mocks.tagsTree = [{ id: 10, name: "内容属性", extra: {}, children: [
    { id: 11, name: "画幅/尺寸", extra: { requiredGroup: true }, children: [
      { id: 12, name: "9:16", extra: {}, children: [] },
      { id: 13, name: "1:1", extra: {}, children: [] },
    ] },
  ] }];
  await run({ extension: "gif", width: 1080, height: 1920 }, { brand: false, product: false, ip: false }, false);
  expect(mocks.predict.mock.calls[0][1].allowEmptyResult).toBe(true);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "completed", result: expect.objectContaining({ tagsWithScore: expect.arrayContaining([
      expect.objectContaining({ leafTagId: 12, score: 100, origin: "aspectRatio" }),
    ]) }),
  }) }));
});
