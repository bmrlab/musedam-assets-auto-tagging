import { reviewScopedAssetsAction } from "@/app/(tagging)/tagging/review/actions";
import { ReviewItem } from "@/app/(tagging)/tagging/review/ReviewItem";
import { setFeatureToggleValue } from "@/hooks/use-feature-library";
import { FEATURE_LIBRARY_TOGGLE_NAMES } from "@/lib/feature-library";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  translate: (key: string) => key,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("next-intl", () => ({ useTranslations: () => mocks.translate, useLocale: () => "en-US" }));
vi.mock("@/components/AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("@/components/ui/icons", () => ({
  ClockCircleIcon: () => null,
  TagAIIcon: () => null,
  TagsIcon: () => null,
}));
vi.mock("@/app/(tagging)/tagging/review/metadata-actions", () => ({ reviewMetadata: vi.fn() }));
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/review/actions", () => ({
  reviewScopedAssetsAction: vi.fn(),
  approveAuditItemsAction: vi.fn(),
  rejectAuditItemsAction: vi.fn(),
  setAuditItemsRejectedAction: vi.fn(),
}));
vi.mock("@/app/(tagging)/tagging/review/components/AddFeatureDialog", () => ({
  AddFeatureDialog: () => null,
}));
vi.mock("@/app/(tagging)/tagging/review/components/AddTagDialog", () => ({
  AddTagDialog: () => null,
}));
vi.mock("@/app/(tagging)/tagging/review/components/FeatureThumbnail", () => ({
  FeatureThumbnail: ({ alt, initialImage }: { alt: string; initialImage?: { signedUrl: string } }) => <img alt={alt} src={initialImage?.signedUrl} />,
}));

function props(): ComponentProps<typeof ReviewItem> {
  const now = new Date("2026-11-06T08:00:00Z");
  const evidence = { confidence: 92, similarity: 0.92, detectionIndex: 0, recommendedTags: [] };
  const brand = {
    ...evidence,
    assetLogoId: "brand-1",
    logoName: "Recognized brand",
    logoTypeId: null,
    logoTypeName: "Logo",
  };
  const product = {
    ...evidence,
    assetProductId: "product-1",
    productName: "Recognized product",
    productTypeId: null,
    productTypeName: "Product",
  };
  const ip = {
    ...evidence,
    assetIpId: "ip-1",
    ipName: "Recognized IP",
    ipTypeId: null,
    ipTypeName: "Character",
  };
  const person = {
    ...evidence,
    assetPersonId: "person-1",
    personName: "Recognized person",
    personTypeId: null,
    personTypeName: "Person",
    rawSimilarity: 0.9,
  };
  const recommendation = <T,>(match: T) => ({
    matches: [match],
    bestMatch: match,
    noConfidentMatch: false,
    recommendedTags: [],
  });
  return {
    assetObject: {
      id: 42,
      teamId: 7,
      slug: "a/42",
      name: "asset.jpg",
      description: "",
      materializedPath: "",
      tags: [],
      content: {},
      extra: { extension: "jpg", size: 100 },
      createdAt: now,
      updatedAt: now,
    },
    existingFeatures: [],
    availableFeatureIds: {
      brand: [brand.assetLogoId],
      product: [product.assetProductId],
      ip: [ip.assetIpId],
      person: [person.assetPersonId],
    },
    featureThumbnails: {},
    batch: [
      {
        queueItem: {
          id: 1,
          teamId: 7,
          assetObjectId: 42,
          taskType: "default",
          status: "completed",
          extra: {},
          createdAt: now,
          updatedAt: now,
          startsAt: now,
          endsAt: now,
          result: {
            brandRecommendation: recommendation(brand),
            productRecommendation: recommendation(product),
            ipRecommendation: recommendation(ip),
            personRecommendation: {
              noConfidentMatch: false,
              faceCount: 1,
              recommendedTags: [],
              faces: [
                {
                  detectionIndex: 0,
                  noConfidentMatch: false,
                  bestMatch: person,
                  topMatches: [person],
                },
              ],
            },
          },
        },
        taggingAuditItems: [
          {
            id: 1,
            teamId: 7,
            queueItemId: 1,
            assetObjectId: 42,
            status: "pending",
            score: 92,
            leafTagId: null,
            tagPath: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    CheckboxComponent: null,
    rejectedFeatureKeys: [],
    manualTags: [],
    manualFeatures: [],
    onToggleFeatureKey: vi.fn(),
    onAddManualTags: vi.fn(),
    onRemoveManualTag: vi.fn(),
    onAddManualFeatures: vi.fn(),
    onRemoveManualFeature: vi.fn(),
  };
}

const names = ["Recognized brand", "Recognized product", "Recognized IP", "Recognized person"];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.params = new URLSearchParams();
  for (const name of FEATURE_LIBRARY_TOGGLE_NAMES) localStorage.setItem(name, "on");
});
afterEach(cleanup);

describe("review feature visibility during settings hydration", () => {
  it("places each manual picker and selection in its own result section", () => {
    const data = props();
    data.manualTags = [{ id: 99, tagPath: ["Manual tag"] }];
    render(<ReviewItem {...data} />);
    const tagPanel = screen.getByText("aiRecommendedTags").parentElement!.parentElement!;
    const featurePanel = screen.getByText("featureRecognition").parentElement!.parentElement!;
    expect(within(tagPanel).getByRole("button", { name: "addTagManually" })).toBeTruthy();
    expect(within(tagPanel).getByText("Manual tag")).toBeTruthy();
    expect(within(tagPanel).queryByRole("button", { name: "addFeatureManually" })).toBeNull();
    expect(within(featurePanel).getByRole("button", { name: "addFeatureManually" })).toBeTruthy();
    expect(within(featurePanel).queryByText("Manual tag")).toBeNull();
  });

  it.each(["all", "features"] as const)("restores older default results in %s history without adding them to the current review", async (contentScope) => {
    const data = props();
    data.batch[0].queueItem.taskType = "default";
    const older = structuredClone(data.batch[0]);
    older.queueItem.id = 2;
    older.queueItem.createdAt = new Date("2026-11-05T08:00:00Z");
    older.taggingAuditItems[0].id = 2;
    older.taggingAuditItems[0].queueItemId = 2;
    older.taggingAuditItems[0].tagPath = ["Historical tag"];
    const result = older.queueItem.result as {
      brandRecommendation: {
        matches: { logoName: string }[];
        bestMatch: { logoName: string };
      };
    };
    result.brandRecommendation.matches[0].logoName = "Historical brand";
    result.brandRecommendation.bestMatch.logoName = "Historical brand";
    data.batch.push(older);
    vi.mocked(reviewScopedAssetsAction).mockResolvedValue({ success: true, data: undefined });
    render(<ReviewItem {...data} contentScope={contentScope} />);
    expect(screen.queryByText("Historical brand")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "showHistory" }));
    expect(screen.getByText("Historical brand")).toBeTruthy();
    if (contentScope === "all") expect(screen.getByText("Historical tag")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "addFeatureManually" })).toHaveLength(1);
    const historicalPanel = screen.getByText("Historical brand").closest(".space-y-2")!;
    expect(within(historicalPanel as HTMLElement).queryByRole("button")).toBeNull();
    if (contentScope === "features") {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "add" })); });
      expect(reviewScopedAssetsAction).toHaveBeenLastCalledWith(expect.objectContaining({
        assetObjects: [expect.objectContaining({ auditItemIds: [1] })],
      }));
    }
    fireEvent.click(screen.getByRole("button", { name: "hideHistory" }));
    expect(screen.queryByText("Historical brand")).toBeNull();
  });

  it("hides feature recommendations from tag-only review", () => {
    const data = props();
    data.batch[0].taggingAuditItems[0].tagPath = ["AI tag"];
    render(<ReviewItem {...data} contentScope="tags" />);
    expect(screen.getByText("AI tag")).toBeTruthy();
    for (const name of names) expect(screen.queryByText(name)).toBeNull();
  });
  it("hides tag recommendations from feature-only review and submits the selected scope", async () => {
    const data = props();
    data.batch[0].taggingAuditItems[0].tagPath = ["AI tag"];
    vi.mocked(reviewScopedAssetsAction).mockResolvedValue({ success: true, data: undefined });
    render(<ReviewItem {...data} metadataAvailable contentScope="features" />);
    expect(screen.queryByText("title")).toBeNull();
    expect(screen.queryByText("AI tag")).toBeNull();
    expect(screen.getByText(names[0])).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "add" })); });
    expect(reviewScopedAssetsAction).toHaveBeenCalledWith(expect.objectContaining({ content: "features", decision: "approve", assetObjects: [expect.objectContaining({ auditItemIds: [1] })] }));
  });
  it("does not offer removal of features already reviewed while labels remain pending", () => {
    const data = props();
    data.batch[0].queueItem.extra = { featureReview: { scoped: true, runStartedAt: data.batch[0].queueItem.startsAt?.toISOString() ?? null, reviewedAt: new Date().toISOString(), result: {} } };
    render(<ReviewItem {...data} contentScope="features" />);
    expect(screen.queryByRole("button", { name: "tooltipRemove" })).toBeNull();
  });
  it("marks completed feature batches reviewed and hides removal controls", () => {
    const data = props();
    data.batch[0].taggingAuditItems[0].status = "approved";
    render(<ReviewItem {...data} />);
    expect(screen.getAllByText("reviewedBadge").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "tooltipRemove" })).toBeNull();
  });
  it("keeps removal controls available for pending feature batches", () => {
    render(<ReviewItem {...props()} />);
    expect(screen.getAllByRole("button", { name: "tooltipRemove" }).length).toBeGreaterThan(0);
  });

  it("warns about historical partial decisions instead of silently showing no features", () => {
    const data = props();
    const result = data.batch[0].queueItem.result as any;
    result.featureDecision = { mode: "llm", ocr: { status: "empty", segments: [] }, decision: { status: "completed", error: "1 of 2 decision batches failed" } };
    render(<ReviewItem {...data} />);
    expect(screen.getByRole("status").textContent).toBe("featureRecognitionIncomplete");
  });

  it.each([61, 92, 97])("renders candidate images and confidence colors at %s without internal details", (confidence) => {
    const data = props();
    const result = data.batch[0].queueItem.result as any;
    const candidate = { ...result.productRecommendation.matches[0],
      assetProductId: "candidate", productName: "Candidate cream", confidence };
    result.productRecommendation = { ...result.productRecommendation,
      decisionSource: "llm", matches: [candidate], bestMatch: candidate };
    data.availableFeatureIds.product.push("candidate");
    data.featureThumbnails["product:candidate"] = { signedUrl: "https://example.com/cream.jpg", signedUrlExpiresAt: Date.now() + 600000 };
    render(<ReviewItem {...data} />);
    const card = screen.getByText("Candidate cream").closest(".border")!;
    expect(card.textContent).toContain(`${confidence}%`);
    expect(card.className).toContain(confidence >= 95 ? "bg-primary-1" : confidence >= 90 ? "bg-[#F6FFED]" : "bg-[#FFF7E6]");
    expect(screen.getByAltText("Candidate cream").getAttribute("src")).toBe("https://example.com/cream.jpg");
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "tooltipRemove" }));
    expect(data.onToggleFeatureKey).toHaveBeenCalledWith("product:candidate");
    expect(screen.queryByText("pendingFeatureConfirmation")).toBeNull();
    expect(screen.queryByText("recognitionEvidence")).toBeNull();
    expect(screen.queryByText("evidenceDetails")).toBeNull();
  });

  it("retains all four classifications while initial false settings hydrate to enabled", () => {
    const data = props();
    const originalBatch = JSON.stringify(data.batch);
    // Server rendering runs before the feature hook's effect: all toggles initially read false.
    const initial = renderToString(<ReviewItem {...data} />);
    for (const name of names) expect(initial).not.toContain(name);

    render(<ReviewItem {...data} />);
    for (const name of names) expect(screen.getByText(name)).toBeTruthy();
    expect(JSON.stringify(data.batch)).toBe(originalBatch);
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    ["featureBrand", "Recognized brand"],
    ["featureProduct", "Recognized product"],
    ["featureIp", "Recognized IP"],
    ["featurePerson", "Recognized person"],
  ] as const)(
    "restores %s after enabling it without replacing the saved classification",
    (toggle, name) => {
      localStorage.setItem(toggle, "off");
      const data = props();
      const originalBatch = JSON.stringify(data.batch);
      render(<ReviewItem {...data} />);
      expect(screen.queryByText(name)).toBeNull();

      act(() => setFeatureToggleValue(toggle, "on"));
      expect(screen.getByText(name)).toBeTruthy();
      act(() => setFeatureToggleValue(toggle, "off"));
      expect(screen.queryByText(name)).toBeNull();
      act(() => setFeatureToggleValue(toggle, "on"));
      expect(screen.getByText(name)).toBeTruthy();
      expect(JSON.stringify(data.batch)).toBe(originalBatch);
    },
  );

  it("restores all classifications when the parent library is enabled", () => {
    localStorage.setItem("featureLibrary", "off");
    render(<ReviewItem {...props()} />);
    for (const name of names) expect(screen.queryByText(name)).toBeNull();
    act(() => setFeatureToggleValue("featureLibrary", "on"));
    for (const name of names) expect(screen.getByText(name)).toBeTruthy();
  });
});
