// @vitest-environment node

import { processQueueItem } from "@/app/(tagging)/queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  brand: vi.fn(),
  ip: vi.fn(),
  fetchSource: vi.fn(),
  prepare: vi.fn(),
  productCount: vi.fn(),
  brandCount: vi.fn(),
  ipCount: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  classifyFeatures: vi.fn(),
  buildRecommendations: vi.fn(),
  predict: vi.fn(),
  mode: "legacy" as "llm" | "legacy",
}));

vi.mock("server-only", () => ({}));
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
  getTaggingSettings: async () => ({ sourceWeights: {} }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    productVector: { count: mocks.productCount },
    logoVector: { count: mocks.brandCount },
    ipVector: { count: mocks.ipCount },
    taggingQueueItem: { update: mocks.update, findUnique: mocks.findUnique },
  },
}));
vi.mock("@/lib/logging", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { rootLogger: logger };
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DECISION_LLM_IMAGE_USE", "false");
  // These source-selection regressions exercise the explicitly configured old flow.
  mocks.mode = "legacy";
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
  vi.unstubAllEnvs();
});

async function run(
  extra: Record<string, unknown>,
  features: { brand?: boolean; product?: boolean; ip?: boolean } = {
    brand: true,
    product: true,
    ip: true,
  },
) {
  await processQueueItem({
    id: 1,
    teamId: 7,
    taskType: "test",
    assetObjectId: 2,
    extra: {
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
    tagsTreeLoader: async () => [],
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

  it("uses a video frame instead of the video download", async () => {
    await run({
      extension: "mp4",
      downloadUrl: "https://example.test/video.mp4",
      thumbnailAccessUrl: "https://example.test/frame.jpg",
    });
    expect(mocks.fetchSource).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/frame.jpg",
      "task thumbnail",
    );
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
      teamId: 7,
      queueItemId: 1,
      assetObjectId: 2,
      fileName: "雅诗兰黛小棕瓶系列.jpg",
      folderPath: "/产品/雅诗兰黛",
      imageMode: false,
      imageInput: preparedSource,
      enabledTypes: ["logo", "product", "ip"],
    });
    expect(mocks.classifyFeatures.mock.calls[0][0].imageInput).toBe(preparedSource);
    const classification = await mocks.classifyFeatures.mock.results[0].value;
    expect(mocks.buildRecommendations).toHaveBeenCalledExactlyOnceWith(classification);
    for (const classify of [mocks.brand, mocks.ip, mocks.product]) {
      expect(classify).not.toHaveBeenCalled();
    }
  });

  it("enables image mode only when DECISION_LLM_IMAGE_USE is true", async () => {
    vi.stubEnv("DECISION_LLM_IMAGE_USE", "true");
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });

    expect(mocks.classifyFeatures).toHaveBeenCalledWith(
      expect.objectContaining({ imageMode: true }),
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
          status: "completed",
          result: expect.objectContaining({
            featureDecision: expect.objectContaining({
              mode: "llm",
              decision: expect.objectContaining({ status: "failed" }),
            }),
          }),
        }),
      }),
    );
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
