import { ReviewItem } from "@/app/(tagging)/tagging/review/ReviewItem";
import { setFeatureToggleValue } from "@/hooks/use-feature-library";
import { FEATURE_LIBRARY_TOGGLE_NAMES } from "@/lib/feature-library";
import { act, cleanup, render, screen } from "@testing-library/react";
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
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/review/actions", () => ({
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
  FeatureThumbnail: () => null,
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
