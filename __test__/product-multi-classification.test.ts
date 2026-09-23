import {
  classifyProductImageCrops,
  classifyProductImageRegions,
  detectProductFigureBoxes,
} from "@/lib/product/product-classification";
import { getAcceptedProductMatches, getProductMatches } from "@/lib/product/product-match-policy";
import type { ClassificationRemoteImageInput } from "@/lib/tagging/classification-image";
import type { TaggingProductBestMatch, TaggingProductRecommendation } from "@/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  query: vi.fn(),
  products: vi.fn(),
  crop: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand/env", () => ({
  getLogoDetectionServerUrl: () => "http://detector.test",
  getLogoDetectionServerToken: () => "test-token",
}));
vi.mock("@/lib/brand/jina", () => ({ createJinaImageEmbeddings: mocks.embed }));
vi.mock("@/lib/product/pgvector", () => ({ queryProductVectorPoints: mocks.query }));
vi.mock("@/prisma/prisma", () => ({ default: { assetProduct: { findMany: mocks.products } } }));
vi.mock("@/lib/product/detection-prompt", () => ({
  buildProductDetectionLabelText: mocks.prompt,
}));
vi.mock("@/lib/tagging/classification-image", () => ({
  cropImageToDataUrl: mocks.crop,
}));

function crop(index: number, label = "object") {
  return {
    box: { xMin: index * 10, yMin: 0, xMax: index * 10 + 10, yMax: 10, score: 0.9, label },
    image: `image-${index}`,
  };
}

function product(id: string, generalCategory = "phone") {
  return {
    id,
    name: id,
    productTypeId: "shared-type",
    productTypeName: "Products",
    description: "",
    generalCategory,
    tags: [{ id: `tag-${id}`, assetTagId: Number(id.replace(/\D/g, "")) || 1, tagPath: [id] }],
  };
}

type Candidate = { id: string; image?: number; description?: number };
function setup(
  candidates: Candidate[][],
  library = Array.from(new Set(candidates.flat().map((c) => c.id))).map((id) => product(id)),
) {
  mocks.embed.mockImplementation(async ({ images }: { images: string[] }) =>
    images.map((_, index) => [index]),
  );
  mocks.products.mockResolvedValue(library);
  mocks.query.mockImplementation(
    async ({ vector, sourceType }: { vector: number[]; sourceType: "image" | "description" }) =>
      (candidates[vector[0]] ?? [])
        .filter((entry) => entry[sourceType] !== undefined)
        .map((entry) => ({
          id: `${entry.id}-${sourceType}`,
          score: entry[sourceType],
          payload: { assetProductId: entry.id, sourceType },
        })),
  );
}

async function classify(count: number) {
  return classifyProductImageCrops({
    teamId: 7,
    crops: Array.from({ length: count }, (_, index) => crop(index)),
  });
}

describe("product classification per detected object", () => {
  beforeEach(() => vi.resetAllMocks());

  it("accepts every distinct box winner above the threshold, including the same product type", async () => {
    setup([[{ id: "p1", image: 0.92 }], [{ id: "p2", image: 0.88 }], [{ id: "p3", image: 0.74 }]]);
    const result = await classify(3);
    expect(result.matches.map((match) => match.assetProductId)).toEqual(["p1", "p2"]);
    expect(result.matches.map((match) => match.productTypeId)).toEqual([
      "shared-type",
      "shared-type",
    ]);
    expect(result.detections.map((detection) => detection.noConfidentMatch)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.noConfidentMatch).toBe(false);
    expect(mocks.products).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: 7, enabled: true, status: "completed" }),
      }),
    );
  });

  it("deduplicates products using strongest confidence and only qualifying box indices", async () => {
    setup([[{ id: "p1", image: 0.81 }], [{ id: "p1", image: 0.89 }], [{ id: "p1", image: 0.76 }]]);
    const result = await classify(3);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      assetProductId: "p1",
      confidence: 89,
      detectionIndex: 1,
      detectionIndices: [0, 1],
    });
    expect(result.detections).toHaveLength(3);
  });

  it("keeps runner-up products as alternatives within the same box", async () => {
    setup([
      [
        { id: "p1", image: 0.91 },
        { id: "p2", image: 0.9 },
      ],
    ]);
    const result = await classify(1);
    expect(result.matches.map((match) => match.assetProductId)).toEqual(["p1"]);
    expect(result.detections[0].topMatches).toHaveLength(2);
  });

  it("does not promote repeated weak detections using evidence from other boxes", async () => {
    setup(Array.from({ length: 5 }, () => [{ id: "p1", image: 0.77 }]));
    const result = await classify(5);
    expect(result.matches).toEqual([]);
    expect(result.noConfidentMatch).toBe(true);
    expect(result.bestMatch?.confidence).toBe(77);
  });

  it("keeps image-description weights and the score cap without label bonuses", async () => {
    setup([
      [{ id: "p1", image: 0.66, description: 0.5 }],
      [{ id: "p1", image: 0.66, description: 0.5 }],
      [{ id: "p2", image: 0.95, description: 0.9 }],
      [{ id: "p3", description: 1 }],
    ]);
    const result = await classifyProductImageCrops({
      teamId: 7,
      crops: [crop(0, "phone"), crop(1, "bottle"), crop(2), crop(3)],
    });
    expect(result.detections.map((detection) => detection.bestMatch?.confidence)).toEqual([
      76, 76, 99, 70,
    ]);
    expect(result.matches.map((match) => match.assetProductId)).toEqual(["p2"]);
  });

  it("uses the existing rounded 80-point confidence threshold", async () => {
    setup([
      [{ id: "p1", image: 0.7949 }],
      [{ id: "p2", image: 0.795 }],
      [{ id: "p3", image: 0.8 }],
    ]);
    const result = await classify(3);
    expect(result.detections.map((detection) => detection.noConfidentMatch)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("returns more than three products and processes boxes after the eighth", async () => {
    setup(Array.from({ length: 11 }, (_, index) => [{ id: `p${index}`, image: 0.85 }]));
    const result = await classify(11);
    expect(result.matches).toHaveLength(11);
    expect(result.detections).toHaveLength(11);
    expect(result.topMatches).toHaveLength(3); // Compatibility summary never limits accepted matches.
    expect(mocks.query).toHaveBeenCalledTimes(22);
  });

  it("preserves empty box diagnostics and excludes unavailable library products", async () => {
    setup([[], [{ id: "deleted", image: 0.95 }]], []);
    const result = await classify(2);
    expect(result.matches).toEqual([]);
    expect(result.detections.map((detection) => detection.bestMatch)).toEqual([null, null]);
    expect(result.noConfidentMatch).toBe(true);
  });

  it("handles an empty crop list and rejects misaligned embedding results", async () => {
    expect(await classify(0)).toMatchObject({
      matches: [],
      detections: [],
      noConfidentMatch: true,
    });
    expect(mocks.embed).not.toHaveBeenCalled();
    mocks.embed.mockResolvedValue([]);
    await expect(classify(1)).rejects.toThrow("embedding count mismatch");
  });

  it("embeds duplicate regions once across labels and preserves their original indices", async () => {
    setup([[{ id: "p1", image: 0.93 }], [{ id: "p2", image: 0.9 }]]);
    const crops = [
      crop(0, "bottle"),
      crop(1, "bottle"),
      crop(0, "lotion"),
      crop(1, "emulsion"),
      crop(0, "cosmetics"),
      crop(1, "cosmetics"),
    ];
    const result = await classifyProductImageCrops({ teamId: 7, crops });
    expect(mocks.embed).toHaveBeenCalledWith({
      images: ["image-0", "image-1"],
      task: "retrieval.query",
    });
    expect(result.rawDetections).toEqual(crops.map((entry) => entry.box));
    expect(result.detections.map(({ sourceDetectionIndices }) => sourceDetectionIndices)).toEqual([
      [0, 2, 4],
      [1, 3, 5],
    ]);
    expect(
      result.matches.map(({ assetProductId, detectionIndices }) => ({
        assetProductId,
        detectionIndices,
      })),
    ).toEqual([
      { assetProductId: "p1", detectionIndices: [0, 2, 4] },
      { assetProductId: "p2", detectionIndices: [1, 3, 5] },
    ]);
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it.each(["bottle", "emulsion", "cosmetics"])(
    "keeps the correct SKU when the representative label is %s",
    async (label) => {
      setup(
        [
          [
            { id: "correct", image: 0.9426903816723408 },
            { id: "wrong", image: 0.9081336967509613 },
          ],
        ],
        [product("correct", "emulsion"), product("wrong", "cosmetics")],
      );
      const result = await classifyProductImageCrops({ teamId: 7, crops: [crop(0, label)] });
      expect(result.matches.map(({ assetProductId }) => assetProductId)).toEqual(["correct"]);
      expect(result.matches[0].confidence).toBe(94);
    },
  );

  it("crops only valid grouped regions, preserving raw boxes and original representative indices", async () => {
    setup([[{ id: "p1", image: 0.93 }], [{ id: "p2", image: 0.9 }]]);
    const imageInput: ClassificationRemoteImageInput = {
      width: 100,
      height: 100,
      buffer: Buffer.from("image"),
      byteLength: 5,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,aW1hZ2U=",
    };
    mocks.crop.mockImplementation(async ({ box }) => `crop-${box.xMin}`);
    const boxes = [
      { ...crop(0).box, xMin: 20, xMax: 10 }, // Reversed, not a one-pixel crop.
      { ...crop(0).box, xMin: -2 },
      { ...crop(0, "lotion").box, score: 0.99 },
      crop(1).box,
      { ...crop(0).box, xMin: 110, xMax: 120 }, // Fully outside the image.
      { ...crop(0).box, xMin: -Infinity },
    ];
    const result = await classifyProductImageRegions({ teamId: 7, imageInput, boxes });
    expect(mocks.crop).toHaveBeenCalledTimes(2);
    expect(mocks.embed).toHaveBeenCalledWith({
      images: ["crop-0", "crop-10"],
      task: "retrieval.query",
    });
    expect(result.rawDetections).toEqual(boxes);
    expect(
      result.detections.map(({ detectionIndex, sourceDetectionIndices }) => ({
        detectionIndex,
        sourceDetectionIndices,
      })),
    ).toEqual([
      { detectionIndex: 2, sourceDetectionIndices: [1, 2] },
      { detectionIndex: 3, sourceDetectionIndices: [3] },
    ]);
  });

  it("requests physical product instances from the detector", async () => {
    mocks.products.mockResolvedValue([product("p1")]);
    mocks.prompt.mockResolvedValue("bottle . cosmetics .");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ detections: [], found: false })));
    try {
      await detectProductFigureBoxes({ teamId: 7, imageBase64: "data:image/jpeg;base64,aW1hZ2U=" });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://detector.test/object_detection_llm",
        expect.objectContaining({
          body: JSON.stringify({
            image_base64: "data:image/jpeg;base64,aW1hZ2U=",
            detection_label_text: "bottle . cosmetics .",
            detection_mode: "product_instances",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});

function savedMatch(id: string, confidence: number, index = 0): TaggingProductBestMatch {
  return {
    assetProductId: id,
    productName: id,
    productTypeId: null,
    productTypeName: "Products",
    description: "",
    generalCategory: "phone",
    similarity: confidence / 100,
    confidence,
    detectionIndex: index,
    imageSimilarity: confidence / 100,
    descriptionSimilarity: 0,
    recommendedTags: [{ assetTagId: 1, tagPath: [id] }],
  };
}

describe("product recommendation compatibility", () => {
  it("normalizes legacy single matches and their historical tag list", () => {
    const legacy: TaggingProductRecommendation = {
      bestMatch: { ...savedMatch("p1", 90), recommendedTags: [] },
      noConfidentMatch: false,
      recommendedTags: [{ assetTagId: 11, tagPath: ["legacy"] }],
    };
    expect(getAcceptedProductMatches(legacy)[0].recommendedTags).toEqual(legacy.recommendedTags);
    expect(getAcceptedProductMatches({ ...legacy, bestMatch: savedMatch("p1", 79) })).toEqual([]);
  });

  it("treats an explicit empty match list as authoritative", () => {
    const result: TaggingProductRecommendation = {
      matches: [],
      bestMatch: savedMatch("old", 99),
      noConfidentMatch: true,
      recommendedTags: [],
    };
    expect(getProductMatches(result)).toEqual([]);
    expect(getAcceptedProductMatches(result)).toEqual([]);
  });

  it("independently filters, deduplicates, and preserves each product's own tags", () => {
    const first = savedMatch("p1", 80, 0);
    const stronger = savedMatch("p1", 95, 1);
    const second = { ...savedMatch("p2", 90, 2), recommendedTags: [] };
    const result: TaggingProductRecommendation = {
      matches: [first, stronger, second, savedMatch("weak", 79)],
      bestMatch: stronger,
      noConfidentMatch: false,
      recommendedTags: [{ assetTagId: 500, tagPath: ["aggregate"] }],
    };
    const accepted = getAcceptedProductMatches(result);
    expect(accepted.map((match) => match.assetProductId)).toEqual(["p1", "p2"]);
    expect(accepted[0]).toMatchObject({ confidence: 95, detectionIndices: [0, 1] });
    expect(accepted[1].recommendedTags).toEqual([]);
    expect(first.detectionIndices).toBeUndefined();
  });
});
