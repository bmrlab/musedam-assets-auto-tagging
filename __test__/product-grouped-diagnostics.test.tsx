import ProductClassifyClient from "@/app/(tagging)/tagging/product/classify/ProductClassifyClient";
import {
  ProductClassificationMatch,
  ProductClassificationResult,
  ProductDetectionBox,
  ProductLibraryPageData,
} from "@/app/(tagging)/tagging/product/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  prepareProductImageUploadAction: vi.fn(),
  prepareProductClassificationAction: vi.fn(),
  classifyProductImageAction: vi.fn(),
}));

vi.mock("@/app/(tagging)/tagging/product/actions", () => actions);
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/s3-browser-upload", () => ({
  uploadS3ObjectFromBrowser: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/brand/browser-image", () => ({
  prepareClientImageUpload: vi.fn(async (file: File) => file),
  getClientImagePreparationErrorCode: vi.fn(),
  CLIENT_IMAGE_PREPARATION_ERROR_CODES: {},
}));

const leftBox: ProductDetectionBox = {
  xMin: 20,
  yMin: 40,
  xMax: 220,
  yMax: 740,
  score: 0.98,
  label: "bottle",
};
const rightBox = { ...leftBox, xMin: 230, xMax: 430 };
const rawBoxes = [
  leftBox,
  rightBox,
  { ...leftBox, label: "cosmetics" },
  { ...rightBox, label: "cosmetics" },
  { ...leftBox, label: "toner" },
  { ...rightBox, label: "lotion" },
];

function match(productName: string, detectionIndex: number): ProductClassificationMatch {
  return {
    assetProductId: productName,
    productName,
    productTypeId: "skincare",
    productTypeName: "Skincare",
    description: "",
    generalCategory: "bottle",
    similarity: 0.95,
    confidence: 95,
    detectionIndex,
    imageSimilarity: 0.95,
    descriptionSimilarity: 0,
    recommendedTags: [],
  };
}

const toner = match("Left Toner", 2);
const lotion = match("Right Lotion", 5);
const classification: ProductClassificationResult = {
  matches: [
    { ...toner, detectionIndices: [0, 2, 4] },
    { ...lotion, detectionIndices: [1, 3, 5] },
  ],
  rawDetections: rawBoxes,
  detections: [
    {
      detectionIndex: 2,
      sourceDetectionIndices: [0, 2, 4],
      box: rawBoxes[2],
      topMatches: [toner],
      bestMatch: toner,
      noConfidentMatch: false,
    },
    {
      detectionIndex: 5,
      sourceDetectionIndices: [1, 3, 5],
      box: rawBoxes[5],
      topMatches: [lotion],
      bestMatch: lotion,
      noConfidentMatch: false,
    },
  ],
  topMatches: [toner, lotion],
  bestMatch: toner,
  noConfidentMatch: false,
  winningDetectionIndex: 2,
};

const library: ProductLibraryPageData = {
  productTypes: [],
  tags: [],
  products: [
    {
      id: "reference",
      slug: "reference",
      name: "Reference",
      productTypeId: "skincare",
      productTypeName: "Skincare",
      description: "",
      generalCategory: "bottle",
      status: "completed",
      enabled: true,
      processingError: null,
      processedAt: null,
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      images: [],
      tags: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 500;
      naturalHeight = 800;
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:product-image");
      static revokeObjectURL = vi.fn();
    },
  );
  actions.prepareProductImageUploadAction.mockResolvedValue({
    success: true,
    data: {
      image: {
        uploadUrl: "https://example.test/upload",
        objectKey: "twin.jpeg",
        mimeType: "image/jpeg",
        size: 10,
      },
    },
  });
  actions.prepareProductClassificationAction.mockResolvedValue({
    success: true,
    data: { imageWidth: 500, imageHeight: 800, detections: rawBoxes },
  });
  actions.classifyProductImageAction.mockResolvedValue({
    success: true,
    data: { result: classification },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function classify() {
  const { container } = render(<ProductClassifyClient initialData={library} />);
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(["image"], "twin.jpeg", { type: "image/jpeg" })] },
  });
  const button = screen.getByRole("button", { name: "classifyButton" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await screen.findByRole("button", { name: "showRawDetections" });
  const image = screen.getByRole("img", { name: "imageToClassify" });
  return {
    overlayLabels: () =>
      Array.from(image.parentElement!.querySelectorAll("span")).map((span) => span.textContent),
  };
}

describe("grouped product diagnostics", () => {
  it("forwards original coordinates so the server can reject invalid regions before cropping", async () => {
    const originalBoxes = [
      { ...leftBox, xMin: -20 },
      { ...rightBox, xMax: 10 },
      ...rawBoxes.slice(2),
    ];
    actions.prepareProductClassificationAction.mockResolvedValue({
      success: true,
      data: { imageWidth: 500, imageHeight: 800, detections: originalBoxes },
    });
    await classify();
    expect(actions.classifyProductImageAction).toHaveBeenCalledWith(
      expect.objectContaining({ boxes: originalBoxes }),
    );
  });

  it("shows two regions and candidate lists for six raw boxes, using representative raw indices", async () => {
    const { overlayLabels } = await classify();

    expect(screen.getByText("productRegions: 2 · rawDetectionBoxes: 6")).toBeTruthy();
    expect(overlayLabels()).toEqual(["region 1 · Left Toner", "region 2 · Right Lotion"]);
    expect(screen.getAllByText("topMatches")).toHaveLength(2);
    expect(screen.getByText("productRegions: 1")).toBeTruthy();
    expect(screen.getByText("productRegions: 2")).toBeTruthy();

    const leftSources = screen.getByText("rawDetectionBoxes: 1, 3, 5");
    expect(leftSources.tagName).toBe("SUMMARY");
    expect(leftSources.closest("details")!.textContent).toContain("box 1 · bottle");
    expect(leftSources.closest("details")!.textContent).toContain("box 3 · cosmetics");
    expect(leftSources.closest("details")!.textContent).toContain("box 5 · toner");
    expect(leftSources.closest("details")!.textContent).toContain(
      "(20, 40) coordinateTo (220, 740)",
    );
    expect(screen.getByText("rawDetectionBoxes: 2, 4, 6")).toBeTruthy();
  });

  it("can toggle all original overlays without duplicating per-region classifications", async () => {
    const { overlayLabels } = await classify();

    fireEvent.click(screen.getByRole("button", { name: "showRawDetections" }));
    expect(overlayLabels()).toEqual([
      "box 1 · bottle",
      "box 2 · bottle",
      "box 3 · cosmetics",
      "box 4 · cosmetics",
      "box 5 · toner",
      "box 6 · lotion",
    ]);
    expect(screen.getAllByText("topMatches")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "showProductRegions" }));
    expect(overlayLabels()).toEqual(["region 1 · Left Toner", "region 2 · Right Lotion"]);
  });
});
