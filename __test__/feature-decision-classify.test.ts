// @vitest-environment node
import { classifyAssetFeatures } from "@/lib/feature-decision/classify";
import type { FeatureDecisionCandidate } from "@/lib/feature-decision/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logo: vi.fn(),
  ip: vi.fn(),
  product: vi.fn(),
  decision: vi.fn(),
  ocr: vi.fn(),
  logos: vi.fn(),
  products: vi.fn(),
  ips: vi.fn(),
  fetchImage: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tagging/feature-threshold-settings", () => ({ getFeatureThresholds: async () => ({ brand: 75, product: 80, ip: 80, person: 60 }) }));
vi.mock("@/lib/brand/logo-classification", () => ({
  classifyBrandImageCrops: mocks.logo,
  detectBrandLogoBoxes: vi.fn(),
}));
vi.mock("@/lib/brand/logo-detection-prompt", () => ({ fetchLogoDetectionLabelText: vi.fn() }));
vi.mock("@/lib/ip/ip-classification", () => ({
  classifyIpImageCrops: mocks.ip,
  detectIpFigureBoxes: vi.fn(),
}));
vi.mock("@/lib/product/product-classification", () => ({
  classifyProductImageRegions: mocks.product,
  detectProductFigureBoxes: vi.fn(),
}));
vi.mock("@/lib/feature-decision/service", () => ({ runFeatureDecision: mocks.decision, recognizeFeatureOcr: mocks.ocr }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetLogo: { findMany: mocks.logos },
    assetProduct: { findMany: mocks.products },
    assetIp: { findMany: mocks.ips },
  },
}));
vi.mock("@/lib/s3", () => ({
  getCachedSignedS3ObjectUrl: ({ objectKey }: { objectKey: string }) => ({ signedUrl: objectKey }),
}));
vi.mock("@/lib/tagging/classification-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tagging/classification-image")>()),
  cropImageToDataUrl: vi.fn().mockResolvedValue("internal-crop"),
  fetchRemoteImageInput: mocks.fetchImage,
}));

const imageInput = {
  width: 1000,
  height: 1000,
  mimeType: "image/jpeg",
  byteLength: 1,
  buffer: Buffer.from([0]),
  dataUrl: "whole-source",
};
const box = (index: number) => ({
  xMin: index * 100,
  yMin: 0,
  xMax: index * 100 + 80,
  yMax: 80,
  score: 0.9,
  label: "object",
});
const logo = (id: string, similarity = 0.99) => ({
  assetLogoId: id,
  logoName: id,
  logoTypeId: null,
  logoTypeName: "Logo",
  similarity,
  confidence: 99,
  detectionIndex: 0,
});
const decisionMatch = (id: string, confidence = 91) => ({
  candidateId: `logo:${id}`,
  confidence,
  reason: "Visible identity matches reference",
  evidence: ["visual"],
  conflicts: [],
  specificityLimit: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ocr.mockResolvedValue({ status: "empty", segments: [] });
  vi.stubEnv("DECISION_LLM_IMAGE_USE", "true");
  mocks.logo.mockResolvedValue({
    topMatches: [logo("first"), logo("lower", 0.6)],
    bestMatch: logo("first"),
    noConfidentMatch: true,
    winningDetectionIndex: 0,
  });
  mocks.logos.mockResolvedValue(
    ["first", "lower"].map((id) => ({ id, notes: "", images: [{ objectKey: `reference-${id}` }] })),
  );
  mocks.products.mockResolvedValue([]);
  mocks.ips.mockResolvedValue([]);
  mocks.fetchImage.mockImplementation(async (url: string) => ({ dataUrl: `prepared-${url}` }));
  mocks.decision.mockResolvedValue({
    ocr: { status: "completed", segments: ["OCR identity"] },
    decision: {
      status: "completed",
      result: { outcome: "matched", matches: [decisionMatch("lower")] },
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("whole-asset feature decision orchestration", () => {
  it("keeps one product per image region and recalls a complete filename identity outside retrieval", async () => {
    const matches = ["first", "lower"].map((id, index) => ({
      assetProductId: id, productName: id, productTypeId: null, productTypeName: "Products",
      description: "", generalCategory: "bottle", confidence: 95 - index,
      similarity: 0.95 - index * 0.01, imageSimilarity: 0.95 - index * 0.01,
      descriptionSimilarity: 0, detectionIndex: 0, detectionIndices: [0], recommendedTags: [],
    }));
    mocks.product.mockResolvedValue({ matches: [matches[0]], topMatches: matches,
      bestMatch: matches[0], noConfidentMatch: false, winningDetectionIndex: 0,
      rawDetections: [box(0)], detections: [{ detectionIndex: 0, sourceDetectionIndices: [0],
        box: box(0), topMatches: matches, bestMatch: matches[0], noConfidentMatch: false }],
    });
    mocks.products.mockResolvedValue([
      ...matches.map(match => ({ id: match.assetProductId, name: match.productName, notes: "", images: [], tags: [] })),
      { id: "415", name: "赫妍魅感裸透镜彩唇釉 415", productTypeId: null, productTypeName: "主推产品",
        description: "", generalCategory: "lip gloss", notes: "", images: [], tags: [] },
    ]);
    mocks.decision.mockResolvedValue({
      ocr: { status: "empty", segments: [] },
      decision: { status: "completed", result: { outcome: "matched", matches: matches.map((match, index) => ({
        ...decisionMatch(match.assetProductId, 95 - index), candidateId: `product:${match.assetProductId}`, evidence: ["retrieval"],
      })) } },
    });
    const result = await classifyAssetFeatures({ teamId: 1, imageInput,
      enabledTypes: ["product"], boxes: { product: [box(0)] }, imageMode: false,
      fileName: "赫妍魅感裸透镜彩唇釉415_试色图",
    });
    expect(result.product?.matches.map(match => match.assetProductId)).toEqual(["415", "first"]);
    expect(result.product?.matches[0]).toMatchObject({ matchingSource: "assetName", detectionIndex: -1, detectionIndices: [] });
    expect(result.product?.topMatches.map(match => match.assetProductId)).toEqual(["first", "lower"]);
  });

  it.each([
    ["logo", true],
    ["logo", false],
    ["product", true],
    ["product", false],
    ["ip", true],
    ["ip", false],
  ] as const)(
    "retains all low-confidence %s alternatives in imageMode=%s",
    async (type, imageMode) => {
      const common = {
        productTypeId: null,
        productTypeName: "Products",
        ipTypeId: null,
        ipTypeName: "IP",
        description: "",
        generalCategory: "",
        recommendedTags: [],
        imageSimilarity: 0.99,
        descriptionSimilarity: 0,
      };
      const retrievalMatches = ["first", "lower"].map((id) => ({
        ...logo(id),
        ...common,
        assetProductId: id,
        productName: id,
        assetIpId: id,
        ipName: id,
        detectionIndices: [0],
      }));
      const retrieval = {
        topMatches: retrievalMatches,
        bestMatch: retrievalMatches[0],
        matches: retrievalMatches,
        noConfidentMatch: false,
        winningDetectionIndex: 0,
        rawDetections: [box(0)],
        detections: [
          {
            detectionIndex: 0,
            sourceDetectionIndices: [0],
            box: box(0),
            topMatches: retrievalMatches,
            bestMatch: retrievalMatches[0],
            noConfidentMatch: false,
          },
        ],
      };
      mocks.logo.mockResolvedValue(retrieval);
      mocks.product.mockResolvedValue(retrieval);
      mocks.ip.mockResolvedValue(retrieval);
      const catalog = ["first", "lower"].map((id) => ({
        id,
        matchPattern: "whole",
        notes: "Catalog nickname",
        images: [{ objectKey: `reference-${id}` }],
      }));
      mocks.products.mockResolvedValue(catalog);
      mocks.ips.mockResolvedValue(catalog);
      const alternatives = ["first", "lower"].map((id, index) => ({
        ...decisionMatch(id, index ? 0 : 43),
        candidateId: `${type}:${id}`,
        evidence: [imageMode ? "visual" : "retrieval"],
        specificityLimit: "Exact variant unresolved",
        conflicts: index ? ["Filename suggests the other variant"] : [],
      }));
      mocks.decision.mockResolvedValue({
        ocr: { status: "completed", segments: ["Series"] },
        decision: { status: "completed", result: { outcome: "matched", matches: alternatives } },
      });
      const result = await classifyAssetFeatures({
        teamId: 1,
        imageInput,
        enabledTypes: [type],
        boxes: { [type]: [box(0)] },
        imageMode,
      });
      const classified =
        type === "logo" ? result.brand : type === "product" ? result.product : result.ip;
      expect(classified?.topMatches.map((entry) => entry.confidence)).toEqual([43, 0]);
      expect(classified?.matches).toEqual([]);
      expect(classified?.bestMatch?.confidence).toBe(43);
      expect(result.diagnostics.decision.result?.matches).toEqual(alternatives);
      expect(mocks.decision).toHaveBeenCalledOnce();
      if (type === "product") expect(mocks.decision.mock.calls[0][0].candidates[0].notes).toBe("Catalog nickname");
    },
  );

  it.each([true, false])(
    "keeps high-confidence limited predictions visible without automatically accepting them in imageMode=%s",
    async (imageMode) => {
      mocks.decision.mockResolvedValue({
        ocr: { status: "empty", segments: [] },
        decision: {
          status: "completed",
          result: {
            outcome: "matched",
            matches: [
              {
                ...decisionMatch("first", 99),
                evidence: [imageMode ? "visual" : "retrieval"],
                conflicts: ["Identity conflict unresolved"],
                specificityLimit: "Only brand association known",
              },
              { ...decisionMatch("lower", 91), evidence: [imageMode ? "visual" : "retrieval"] },
            ],
          },
        },
      });
      const result = await classifyAssetFeatures({
        teamId: 1,
        imageInput,
        enabledTypes: ["logo"],
        boxes: { logo: [box(0)] },
        imageMode,
      });
      expect(result.brand?.topMatches.map((entry) => entry.assetLogoId)).toEqual([
        "first",
        "lower",
      ]);
      expect(result.brand?.matches?.map((entry) => entry.assetLogoId)).toEqual(["lower"]);
      expect(result.brand?.bestMatch?.assetLogoId).toBe("lower");
    },
  );

  it("uses text mode by default and enables image evidence only when the env key is true", async () => {
    const input = {
      teamId: 1,
      imageInput,
      enabledTypes: ["logo" as const],
      boxes: { logo: [box(0)] },
      fileName: "lower.jpg",
      folderPath: "/Brands/lower",
    };
    mocks.decision.mockResolvedValueOnce({
      ocr: { status: "completed", segments: ["lower"] },
      decision: {
        status: "completed",
        result: {
          outcome: "matched",
          matches: [{ ...decisionMatch("lower"), evidence: ["retrieval", "ocr"] }],
        },
      },
    });
    vi.stubEnv("DECISION_LLM_IMAGE_USE", "false");
    const result = await classifyAssetFeatures(input);
    expect(result.brand?.bestMatch?.assetLogoId).toBe("lower");
    expect(result.brand?.bestMatch?.confidence).toBe(91);
    expect(result.diagnostics).toMatchObject({
      mode: "llm",
      decisionInputMode: "text",
      ocr: { status: "completed" },
      decision: { status: "completed" },
    });
    expect(mocks.logo.mock.calls[0][0].retrievalOnly).toBe(true);
    expect(mocks.decision).toHaveBeenCalledOnce();
    expect(mocks.decision.mock.calls[0][0]).toMatchObject({
      imageMode: false,
      fileName: input.fileName,
      folderPath: input.folderPath,
    });
    expect(
      mocks.decision.mock.calls[0][0].candidates.every(
        (candidate: FeatureDecisionCandidate) => candidate.referenceImage === undefined,
      ),
    ).toBe(true);
    expect(mocks.fetchImage).not.toHaveBeenCalled();
    vi.stubEnv("DECISION_LLM_IMAGE_USE", "true");
    const next = await classifyAssetFeatures(input);
    expect(next.diagnostics).toMatchObject({ mode: "llm", decisionInputMode: "image" });
    expect(mocks.decision).toHaveBeenCalledTimes(2);
    expect(mocks.fetchImage).toHaveBeenCalledTimes(2);
  });

  it("retains every product region in text-only mode", async () => {
    const boxes = Array.from({ length: 9 }, (_, index) => box(index));
    mocks.product.mockResolvedValue({
      topMatches: [],
      matches: [],
      bestMatch: null,
      rawDetections: boxes,
      detections: [],
      noConfidentMatch: true,
      winningDetectionIndex: null,
    });
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["product"],
      boxes: { product: boxes },
      imageMode: false,
    });
    expect(mocks.product.mock.calls[0][0].boxes).toHaveLength(9);
    expect(result.diagnostics.retrieval?.regionsSelected).toBe(9);
    expect(result.diagnostics.decisionInputMode).toBe("text");
    expect(mocks.decision).toHaveBeenCalledOnce();
  });

  it("retains text candidates even when their reference images are missing", async () => {
    mocks.logos.mockResolvedValue(
      ["first", "lower"].map((id) => ({ id, notes: "Catalog description", images: [] })),
    );
    await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
      imageMode: false,
    });
    expect(mocks.decision.mock.calls[0][0].candidates).toHaveLength(2);
    expect(mocks.fetchImage).not.toHaveBeenCalled();
  });

  it("accepts a lower retrieval rank with LLM confidence and omits crops/boxes from its input", async () => {
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
      fileName: "中文名称.jpg",
      folderPath: "/catalog",
    });
    expect(result.brand?.matches?.map((match) => match.assetLogoId)).toEqual(["lower"]);
    expect(result.brand?.bestMatch?.confidence).toBe(91);
    expect(result.brand?.bestMatch?.similarity).toBe(0.6);
    expect(mocks.decision).toHaveBeenCalledOnce();
    const request = mocks.decision.mock.calls[0][0];
    expect(request).toMatchObject({
      sourceImage: "whole-source",
      fileName: "中文名称.jpg",
      folderPath: "/catalog",
    });
    expect(
      request.candidates.map((candidate: FeatureDecisionCandidate) => candidate.referenceImage),
    ).toEqual(["prepared-reference-first", "prepared-reference-lower"]);
    expect(JSON.stringify(request.candidates)).not.toContain("xMin");
    expect(JSON.stringify(request.candidates)).not.toContain("internal-crop");
    expect(mocks.logos.mock.calls.find(call => call[0].select.images)?.[0].select.images.orderBy).toEqual([
      { sort: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it.each(["failed", "completed"])(
    "does not resurrect retrieval winners after a %s empty decision",
    async (status) => {
      mocks.decision.mockResolvedValue({
        ocr: { status: "empty", segments: [] },
        decision: {
          status,
          result: status === "completed" ? { outcome: "no_match", matches: [] } : undefined,
        },
      });
      const result = await classifyAssetFeatures({
        teamId: 1,
        imageInput,
        enabledTypes: ["logo"],
        boxes: { logo: [box(0)] },
      });
      expect(result.brand).toMatchObject({
        matches: [],
        topMatches: [],
        bestMatch: null,
        noConfidentMatch: true,
      });
    },
  );

  it("keeps references that cannot load unassessed and does not autoaccept conflicting or metadata-only logos", async () => {
    mocks.fetchImage.mockRejectedValueOnce(new Error("missing reference"));
    mocks.decision.mockResolvedValue({
      ocr: { status: "empty", segments: [] },
      decision: {
        status: "completed",
        result: {
          outcome: "matched",
          matches: [{ ...decisionMatch("lower"), evidence: ["filename"] }],
        },
      },
    });
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
    });
    expect(mocks.decision.mock.calls[0][0].candidates).toHaveLength(1);
    expect(result.diagnostics.retrieval?.unassessedCandidates).toEqual([
      { candidateId: "logo:first", reason: "missing reference" },
    ]);
    expect(result.brand?.matches).toEqual([]);
  });

  it("retrieves every distinct region independently across feature types", async () => {
    mocks.ip.mockResolvedValue({
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    });
    mocks.product.mockResolvedValue({
      topMatches: [],
      matches: [],
      bestMatch: null,
      rawDetections: [],
      detections: [],
      noConfidentMatch: true,
      winningDetectionIndex: null,
    });
    const boxes = Array.from({ length: 8 }, (_, i) => box(i));
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo", "product", "ip"],
      boxes: { logo: boxes, product: boxes, ip: boxes },
    });
    const count =
      mocks.logo.mock.calls[0][0].crops.length +
      mocks.ip.mock.calls[0][0].crops.length +
      mocks.product.mock.calls[0][0].boxes.length;
    expect(count).toBe(24);
    expect(result.diagnostics.retrieval?.regionsOmitted).toBe(0);
    expect(mocks.decision).toHaveBeenCalledOnce();
  });

  it("withholds rejected exact identity tags while preserving generic and accepted shared tags", async () => {
    mocks.logos.mockResolvedValue([
      {
        id: "first",
        notes: "",
        images: [{ objectKey: "reference-first" }],
        tags: [
          { assetTagId: 1, tagPath: ["first"] },
          { assetTagId: 2, tagPath: ["Generic brand"] },
          { assetTagId: 3, tagPath: ["first"] },
        ],
      },
      {
        id: "lower",
        notes: "",
        images: [{ objectKey: "reference-lower" }],
        tags: [{ assetTagId: 3, tagPath: ["first"] }],
      },
    ]);
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
    });
    expect(result.unacceptedIdentityTagIds).toEqual([1]);
  });

  it("retains candidate diagnostics and marks missing references unassessed after metadata failure", async () => {
    mocks.logos.mockRejectedValue(new Error("catalog unavailable"));
    mocks.decision.mockResolvedValue({
      ocr: { status: "empty", segments: [] },
      decision: { status: "skipped" },
    });
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
    });
    expect(result.diagnostics.retrieval?.errors).toEqual([
      "logo reference metadata: catalog unavailable",
    ]);
    expect(result.diagnostics.retrieval?.unassessedCandidates).toHaveLength(2);
    expect(result.brand).toMatchObject({ matches: [], bestMatch: null });
  });

  it("does not allow general tagging to bypass an LLM confidence threshold", async () => {
    mocks.logos.mockResolvedValue(
      ["first", "lower"].map((id, index) => ({
        id,
        notes: "",
        images: [{ objectKey: `reference-${id}` }],
        tags: [{ assetTagId: index + 1, tagPath: [id] }],
      })),
    );
    mocks.decision.mockResolvedValue({
      ocr: { status: "empty", segments: [] },
      decision: {
        status: "completed",
        result: { outcome: "matched", matches: [decisionMatch("lower", 70)] },
      },
    });
    const result = await classifyAssetFeatures({
      teamId: 1,
      imageInput,
      enabledTypes: ["logo"],
      boxes: { logo: [box(0)] },
    });
    expect(result.brand?.topMatches[0].confidence).toBe(70);
    expect(result.brand?.matches).toEqual([]);
    expect(result.unacceptedIdentityTagIds).toEqual([1, 2]);
  });
});


describe("folder configured logo recall", () => {
  it("adds an exact folder alias missed by the vector top results and accepts path evidence", async () => {
    mocks.logos.mockResolvedValue([{ id: "snow", name: "雪花秀/SULWHASOO LOGO(1)", logoTypeId: null,
      logoType: { name: "主Logo" }, notes: "素材画面和文件夹名称包含SULWHASOO的都需要打出该特征",
      images: [{ objectKey: "snow-ref" }], tags: [] }]);
    mocks.decision.mockResolvedValue({ ocr: { status: "empty", segments: [] }, decision: {
      status: "completed", result: { outcome: "matched", matches: [{ ...decisionMatch("snow", 94), evidence: ["path"] }] },
    } });
    const result = await classifyAssetFeatures({ teamId: 1, imageInput, enabledTypes: ["logo"],
      imageMode: false, folderPath: "amore/雪花秀-琉光系列/成分&质地", boxes: { logo: [box(0)] } });
    const candidate = mocks.decision.mock.calls[0][0].candidates.find((c: FeatureDecisionCandidate) => c.classId === "snow");
    expect(candidate).toMatchObject({ similarity: 0, regionIds: [], folderMatch: { alias: "雪花秀" } });
    expect(result.brand?.matches?.map(m => m.assetLogoId)).toEqual(["snow"]);
    expect(result.diagnostics.folderMatchedLogoIds).toEqual(["snow"]);
  });
  it("does not add metadata-only logos without an explicit folder rule", async () => {
    mocks.logos.mockResolvedValue([{ id: "snow", name: "雪花秀/SULWHASOO LOGO(1)", notes: "可见的主Logo", images: [] }]);
    await classifyAssetFeatures({ teamId: 1, imageInput, enabledTypes: ["logo"], imageMode: false,
      folderPath: "雪花秀", boxes: { logo: [box(0)] } });
    expect(mocks.decision.mock.calls[0][0].candidates.some((c: FeatureDecisionCandidate) => c.classId === "snow")).toBe(false);
  });
});

describe("OCR logo recall", () => {
  it("recalls a missing logo from literal OCR without claiming a vector hit", async () => {
    mocks.ocr.mockResolvedValue({ status: "completed", source: "musedam", segments: ["Sulwhasoo"] });
    mocks.logos.mockResolvedValue([{ id: "snow", name: "雪花秀/SULWHASOO LOGO(1)", notes: "", logoTypeId: null, logoTypeName: "Logo", images: [{ objectKey: "snow-ref" }] }]);
    mocks.decision.mockResolvedValue({ ocr: { status: "completed", segments: ["Sulwhasoo"] }, decision: { status: "completed", result: { outcome: "matched", matches: [{ ...decisionMatch("snow", 94), evidence: ["ocr"] }] } } });
    const result = await classifyAssetFeatures({ teamId: 1, imageInput, imageMode: false, enabledTypes: ["logo"], boxes: { logo: [box(0)] }, ocrSegments: ["Sulwhasoo"] });
    expect(result.brand?.matches?.map(m => m.assetLogoId)).toEqual(["snow"]);
    expect(result.diagnostics.ocrMatchedLogoIds).toEqual(["snow"]);
    expect(mocks.decision.mock.calls[0][0]).toMatchObject({ ocr: { segments: ["Sulwhasoo"] } });
    expect(mocks.decision.mock.calls[0][0].candidates.find((c: FeatureDecisionCandidate) => c.classId === "snow")).toMatchObject({ similarity: 0, regionIds: [], ocrMatch: { alias: "SULWHASOO" } });
    expect(mocks.ocr).toHaveBeenCalledOnce();
  });
});
