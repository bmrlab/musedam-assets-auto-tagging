import TestClient from "@/app/(tagging)/tagging/test/TestClient";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  translate: (key: string) => key,
  start: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate }));
vi.mock("@/components/ui", () => ({ TagOutlinedIcon: () => null, VimIcon: () => null }));
vi.mock("@/components/ui/icons", () => ({ FileImageIcon: () => null, TagsIcon: () => null }));
vi.mock("@/components/AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/test/actions", () => ({
  startTaggingTasksAction: mocks.start,
  uploadLocalTestFileAction: vi.fn(),
}));
vi.mock("@/app/(tagging)/tagging/test/components/actions", () => ({
  getFeatureThumbnailsAction: async () => ({ success: true, data: {} }),
}));
vi.mock("@/app/(tagging)/tagging/test/components/FeatureThumbnail", () => ({
  FeatureThumbnail: () => null,
}));

const productName = "兰芝保湿睡眠唇膜 草莓蛋糕味";
const product = {
  assetProductId: "53b2951a-eeea-4594-986d-33702b35d149",
  productName,
  productTypeId: "d4564f46-d504-4104-8955-db26b38ba9b1",
  productTypeName: "主推产品",
  confidence: 92,
  similarity: 0.9516337107311473,
  detectionIndex: 0,
  recommendedTags: [{ assetTagId: 1507, tagPath: ["产品品类", "护肤", "唇部护理"] }],
};
const queueItem = {
  id: 606,
  status: "completed",
  assetObject: { id: 804, name: "error.jpg", extra: { extension: "jpg", size: 9300 } },
  extra: { recognitionAccuracy: "balanced", featureProduct: true, featureBrand: true },
  result: {
    tagsWithScore: [],
    productRecommendation: { matches: [product], bestMatch: product, noConfidentMatch: false },
  },
};

function persist(isPolling = false, hasJobs = true) {
  sessionStorage.setItem(
    "musedam-tagging-test-page-state",
    JSON.stringify({
      version: 1,
      selectedAssets: [{ id: "804", name: "error.jpg", extension: "jpg", size: 9300 }],
      taggingResults: [],
      failedResults: [],
      queueItemIds: hasJobs ? [606] : [],
      isPolling,
      pollingStartedAt: Date.now(),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.params = new URLSearchParams();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  mocks.start.mockResolvedValue({
    success: true,
    data: {
      successCount: 1,
      failedCount: 0,
      failedAssets: [],
      queueItemIds: [606],
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { items: [queueItem], missingIds: [] } }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("test page full result pipeline", () => {
  it("shows the accepted product returned by polling for a newly started test", async () => {
    persist(false, false);
    render(<TestClient />);
    fireEvent.click(screen.getByRole("button", { name: "startTest" }));
    await waitFor(() => expect(screen.getByText(productName)).toBeTruthy());
  });

  it("shows the accepted product when restoring an in-progress test", async () => {
    persist(true);
    render(<TestClient />);
    await waitFor(() => expect(screen.getByText(productName)).toBeTruthy());
  });

  it("refreshes completed saved jobs to recover features missing from cached display data", async () => {
    persist();
    const saved = JSON.parse(sessionStorage.getItem("musedam-tagging-test-page-state")!);
    saved.taggingResults = [
      {
        asset: {
          id: "804",
          name: "error.jpg",
          extension: "jpg",
          size: 9300,
          categories: [],
          processingTime: 120,
          recognitionMode: "balanced",
        },
        overallScore: 96,
        brands: [],
        ips: [],
        products: [],
        personRecognition: null,
        effectiveTags: [],
        candidateTags: [],
        strategyAnalysis: [],
      },
    ];
    sessionStorage.setItem("musedam-tagging-test-page-state", JSON.stringify(saved));
    render(<TestClient />);
    await waitFor(() => expect(screen.getByText(productName)).toBeTruthy());
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("continues hiding products when product visibility is disabled", async () => {
    localStorage.setItem("featureProduct", "off");
    persist(true);
    render(<TestClient />);
    await waitFor(() => expect(screen.getByText("noRecognizedFeatures")).toBeTruthy());
    expect(screen.queryByText(productName)).toBeNull();
    const saved = JSON.parse(sessionStorage.getItem("musedam-tagging-test-page-state")!);
    expect(saved.taggingResults[0].products[0].productName).toBe(productName);
  });
});
