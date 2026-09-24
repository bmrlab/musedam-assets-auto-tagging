// @vitest-environment node

import { processQueueItem } from "@/app/(tagging)/queue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  product: vi.fn(),
  brand: vi.fn(),
  preview: vi.fn(),
  productCount: vi.fn(),
  update: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/product/tagging-product-classification", () => ({
  classifyAssetProductRecommendation: mocks.product,
}));
vi.mock("@/lib/brand/tagging-brand-classification", () => ({
  classifyAssetBrandRecommendation: mocks.brand,
}));
vi.mock("@/lib/tagging/classification-image", () => ({ fetchRemoteImageInput: mocks.preview }));
vi.mock("@/app/(tagging)/predict", () => ({
  predictAssetTags: async () => ({ predictions: {}, tagsWithScore: [], usage: {} }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    productVector: { count: mocks.productCount },
    logoVector: { count: async () => 1 },
    taggingQueueItem: { update: mocks.update },
  },
}));
vi.mock("@/lib/logging", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { rootLogger: logger };
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.productCount.mockResolvedValue(1);
  mocks.product.mockResolvedValue(null);
  mocks.brand.mockResolvedValue(null);
  mocks.preview.mockResolvedValue({ dataUrl: "thumbnail" });
});

async function run(extra: Record<string, unknown>, brand = false) {
  await processQueueItem({
    id: 1,
    teamId: 7,
    taskType: "test",
    assetObjectId: 2,
    extra: {
      featureClassify: true,
      featureBrand: brand,
      featureProduct: true,
      featurePerson: false,
      featureIp: false,
    },
    assetObject: { id: 2, teamId: 7, slug: "test", extra },
    tagsTreeLoader: async () => [],
  } as unknown as Parameters<typeof processQueueItem>[0]);
}

describe("automatic product source selection", () => {
  it("uses the original image for products while brand continues using its thumbnail", async () => {
    await run(
      {
        extension: "jpg",
        downloadUrl: "https://example.test/original.jpg",
        thumbnailAccessUrl: "https://example.test/thumbnail.jpg",
      },
      true,
    );
    expect(mocks.product).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageUrl: "https://example.test/original.jpg",
    });
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/thumbnail.jpg",
      "feature classification",
    );
    expect(mocks.brand).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageInput: { dataUrl: "thumbnail" },
    });
  });

  it("uses a video preview instead of trying to embed the video download", async () => {
    await run({
      extension: "mp4",
      downloadUrl: "https://example.test/video.mp4",
      thumbnailAccessUrl: "https://example.test/frame.jpg",
    });
    expect(mocks.product).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageUrl: "https://example.test/frame.jpg",
    });
  });

  it("can classify an original image when no thumbnail is available", async () => {
    await run({ extension: "png", downloadUrl: "https://example.test/original.png" });
    expect(mocks.product).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageUrl: "https://example.test/original.png",
    });
  });

  it("uses the available thumbnail when the original URL is missing", async () => {
    await run({ extension: "jpg", thumbnailAccessUrl: "https://example.test/thumbnail.jpg" });
    expect(mocks.product).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageUrl: "https://example.test/thumbnail.jpg",
    });
  });

  it("does not fetch images for an empty product library", async () => {
    mocks.productCount.mockResolvedValue(0);
    await run({ extension: "jpg", downloadUrl: "https://example.test/original.jpg" });
    expect(mocks.product).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
