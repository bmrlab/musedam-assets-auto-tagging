import { processAssetProductReferenceVectors } from "@/lib/product/product-processing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  textEmbed: vi.fn(),
  translate: vi.fn(),
  prepareSquare: vi.fn(),
  predictCategory: vi.fn(),
  remove: vi.fn(),
  upsert: vi.fn(),
  payload: vi.fn(),
  product: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  imageUpdate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.predictCategory }));
vi.mock("@/lib/brand/env", () => ({ getJinaConfig: () => ({ model: "jina-clip-v2" }) }));
vi.mock("@/lib/brand/jina", () => ({
  createJinaImageEmbeddings: mocks.embed,
  createJinaTextEmbeddings: mocks.textEmbed,
}));
vi.mock("@/lib/product/pgvector", () => ({
  deleteProductVectorPointsByProduct: mocks.remove,
  upsertProductVectorPoints: mocks.upsert,
  setProductVectorPayloadByProduct: mocks.payload,
}));
vi.mock("@/lib/s3", () => ({
  getCachedSignedS3ObjectUrl: () => ({ signedUrl: "https://reference.invalid/image" }),
}));
vi.mock("@/lib/tagging/reference-image", () => ({
  prepareSquareEmbeddingImageBuffer: mocks.prepareSquare,
}));
vi.mock("@/lib/translation/service", () => ({ translateTextToEnglish: mocks.translate }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetProduct: mocks.product,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ assetProduct: mocks.product, assetProductImage: { update: mocks.imageUpdate } }),
  },
}));

function productFixture(description = "") {
  return {
    id: "p",
    teamId: 1,
    enabled: true,
    name: "Bottle",
    productTypeId: null,
    productTypeName: "Products",
    description,
    notes: "",
    images: [{ id: "i", objectKey: "reference.jpg" }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.product.updateMany.mockResolvedValue({ count: 1 });
  mocks.product.update.mockResolvedValue({});
  mocks.payload.mockResolvedValue(undefined);
  mocks.product.findFirst.mockResolvedValue(productFixture());
  mocks.prepareSquare.mockResolvedValue(Buffer.from("normalized-square-png"));
  mocks.predictCategory.mockResolvedValue({ object: { general_category: "bottle" } });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("new product reference embeddings", () => {
  it("normalizes the original image with the shared helper and embeds its PNG once", async () => {
    mocks.embed.mockResolvedValueOnce([[0, 1]]);
    await processAssetProductReferenceVectors({ teamId: 1, productId: "p" });

    const image = `data:image/png;base64,${Buffer.from("normalized-square-png").toString("base64")}`;
    expect(mocks.prepareSquare).toHaveBeenCalledExactlyOnceWith(Buffer.from([1, 2]));
    expect(mocks.embed).toHaveBeenCalledExactlyOnceWith({ images: [image], padToSquare: true });
    expect(mocks.predictCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([{ type: "image", image }]),
          }),
        ],
      }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith([expect.objectContaining({ vector: [0, 1] })]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.embed.mock.invocationCallOrder[0],
    );
    expect(mocks.imageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ embeddingModel: "jina-clip-v2" }),
      }),
    );
  });

  it("does not delete existing vectors when embedding generation fails", async () => {
    mocks.embed.mockRejectedValueOnce(new Error("Jina embeddings request failed (429)"));
    await expect(
      processAssetProductReferenceVectors({ teamId: 1, productId: "p" }),
    ).rejects.toThrow("429");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("keeps description embeddings unchanged", async () => {
    mocks.product.findFirst.mockResolvedValueOnce(productFixture("A tall bottle"));
    mocks.embed.mockResolvedValueOnce([[0, 1]]);
    mocks.translate.mockResolvedValueOnce("A tall bottle");
    mocks.textEmbed.mockResolvedValueOnce([[0.3, 0.7]]);
    await processAssetProductReferenceVectors({ teamId: 1, productId: "p" });

    expect(mocks.textEmbed).toHaveBeenCalledWith({ texts: ["A tall bottle"] });
    expect(mocks.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        vector: [0, 1],
        payload: expect.objectContaining({ sourceType: "image" }),
      }),
      expect.objectContaining({
        vector: [0.3, 0.7],
        payload: expect.objectContaining({ sourceType: "description" }),
      }),
    ]);
  });

  it("does not reprocess a completed product or replace its existing vectors", async () => {
    mocks.product.updateMany.mockResolvedValueOnce({ count: 0 });
    await processAssetProductReferenceVectors({ teamId: 1, productId: "p" });

    expect(mocks.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["pending", "processing"] } }),
      }),
    );
    expect(mocks.product.findFirst).not.toHaveBeenCalled();
    expect(mocks.prepareSquare).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.imageUpdate).not.toHaveBeenCalled();
  });
});
