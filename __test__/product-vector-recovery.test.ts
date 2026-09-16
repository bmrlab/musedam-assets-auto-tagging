import { processPendingAssetLogoReferenceVectors } from "@/lib/brand/logo-processing";
import { processPendingAssetIpReferenceVectors } from "@/lib/ip/ip-processing";
import { processPendingAssetProductReferenceVectors } from "@/lib/product/product-processing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assetIp: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  assetLogo: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  assetProduct: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetIp: mocks.assetIp,
    assetLogo: mocks.assetLogo,
    assetProduct: mocks.assetProduct,
  },
}));
vi.mock("@/ai/provider", () => ({ llm: vi.fn() }));
vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/brand/env", () => ({ getJinaConfig: vi.fn() }));
vi.mock("@/lib/brand/image", () => ({ bufferToDataUrl: vi.fn() }));
vi.mock("@/lib/brand/jina", () => ({
  createJinaImageEmbeddings: vi.fn(),
  createJinaTextEmbeddings: vi.fn(),
}));
vi.mock("@/lib/s3", () => ({ getCachedSignedS3ObjectUrl: vi.fn() }));
vi.mock("@/lib/tagging/reference-image", () => ({ prepareReferenceImageBuffer: vi.fn() }));
vi.mock("@/lib/tagging/classification-image", () => ({ cropImageToDataUrl: vi.fn() }));
vi.mock("@/lib/translation/service", () => ({ translateTextToEnglish: vi.fn() }));
vi.mock("@/lib/brand/pgvector", () => ({
  deleteLogoVectorPointsByLogo: vi.fn(),
  setLogoVectorPayloadByLogo: vi.fn(),
  upsertLogoVectorPoints: vi.fn(),
}));
vi.mock("@/lib/ip/pgvector", () => ({
  deleteIpVectorPointsByIp: vi.fn(),
  setIpVectorPayloadByIp: vi.fn(),
  upsertIpVectorPoints: vi.fn(),
}));
vi.mock("@/lib/product/pgvector", () => ({
  deleteProductVectorPointsByProduct: vi.fn(),
  setProductVectorPayloadByProduct: vi.fn(),
  upsertProductVectorPoints: vi.fn(),
}));

describe("Feature vector recovery queues", () => {
  beforeEach(() => {
    for (const model of [mocks.assetLogo, mocks.assetIp, mocks.assetProduct]) {
      model.findMany.mockReset();
      model.updateMany.mockReset();
    }
  });

  it.each([
    ["Logo", mocks.assetLogo, processPendingAssetLogoReferenceVectors],
    ["IP", mocks.assetIp, processPendingAssetIpReferenceVectors],
    ["Product", mocks.assetProduct, processPendingAssetProductReferenceVectors],
  ] as const)(
    "returns stale %s processing records to pending",
    async (_name, model, processPending) => {
      model.updateMany.mockResolvedValueOnce({ count: 3 });
      model.findMany.mockResolvedValueOnce([]);

      const result = await processPending();

      expect(model.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "processing" }),
          data: { status: "pending" },
        }),
      );
      expect(result).toEqual({ processing: 0, recovered: 3, skipped: 0 });
    },
  );

  it("atomically claims pending products before processing them", async () => {
    mocks.assetProduct.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.assetProduct.findMany.mockResolvedValueOnce([{ id: "product-1", teamId: 7 }]);

    const result = await processPendingAssetProductReferenceVectors();

    expect(mocks.assetProduct.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "product-1", teamId: 7, status: "pending" },
        data: { status: "processing", processingError: null, processedAt: null },
      }),
    );
    expect(result).toEqual({ processing: 1, recovered: 0, skipped: 0 });
  });
});
