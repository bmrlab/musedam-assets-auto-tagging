// @vitest-environment node

import { processQueueItem } from "@/app/(tagging)/queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/tagging/classification-image", () => ({
  fetchRemoteImageSource: mocks.fetchSource,
  prepareImageInput: mocks.prepare,
  isImageTooLargeError: (error: unknown) =>
    error instanceof Error && error.message === "image too large",
}));
vi.mock("@/app/(tagging)/predict", () => ({
  predictAssetTags: async () => ({ predictions: {}, tagsWithScore: [], usage: {} }),
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
  mocks.productCount.mockResolvedValue(1);
  mocks.brandCount.mockResolvedValue(1);
  mocks.ipCount.mockResolvedValue(1);
  mocks.product.mockResolvedValue(null);
  mocks.brand.mockResolvedValue(null);
  mocks.ip.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(null);
  mocks.update.mockResolvedValue({});
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
    assetObject: { id: 2, teamId: 7, slug: "test", extra },
    tagsTreeLoader: async () => [],
  } as unknown as Parameters<typeof processQueueItem>[0]);
}

describe("automatic object detection source selection", () => {
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
