import {
  ProductRecognitionResult,
  TaggingResult,
  TaggingResultDisplay,
} from "@/app/(tagging)/tagging/test/components/TaggingResultDisplay";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui", () => ({
  TagOutlinedIcon: () => null,
  VimIcon: () => null,
}));

vi.mock("@/hooks/use-feature-library", () => ({
  useFeatureLibraryFeatures: () => ({
    featureProduct: true,
    featureBrand: false,
    featureIp: false,
    featurePerson: false,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/(tagging)/tagging/test/components/FeatureThumbnail", () => ({
  FeatureThumbnail: () => null,
}));

function product(name: string, confidence: number): ProductRecognitionResult {
  return {
    noConfidentMatch: false,
    productName: name,
    productTypeName: "Electronics",
    confidence,
    similarity: confidence / 100,
    imageSimilarity: confidence / 100,
    descriptionSimilarity: 0,
    assetProductId: name,
    recommendedTags: [{ tagPath: ["Products", name] }],
  };
}

function result(overrides: Partial<TaggingResult>): TaggingResult {
  return {
    asset: {
      id: "asset-1",
      name: "Multiple products",
      extension: "jpg",
      size: 100,
      categories: [],
      processingTime: 1,
      recognitionMode: "balanced",
    },
    overallScore: 92,
    brandRecognition: null,
    ipRecognition: null,
    personRecognition: null,
    effectiveTags: [],
    candidateTags: [],
    strategyAnalysis: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("product feature results", () => {
  it("shows every accepted product with its own confidence and tags, including more than three", () => {
    render(
      <TaggingResultDisplay
        result={result({
          products: [
            product("Phone", 92),
            product("Headphones", 88),
            product("Camera", 84),
            product("Speaker", 80),
            product("Bottle", 74),
          ],
        })}
      />,
    );

    for (const [name, confidence] of [
      ["Phone", 92],
      ["Headphones", 88],
      ["Camera", 84],
      ["Speaker", 80],
    ] as const) {
      expect(screen.getByText(name)).toBeTruthy();
      expect(screen.getByText(`confidence: ${confidence}%`)).toBeTruthy();
      expect(screen.getByText(`Products > ${name}`)).toBeTruthy();
    }
    expect(screen.queryByText("Bottle")).toBeNull();
    expect(screen.queryByText("Products > Bottle")).toBeNull();
  });

  it("shows an older saved single-product result", () => {
    render(
      <TaggingResultDisplay result={result({ productRecognition: product("Legacy Phone", 91) })} />,
    );

    expect(screen.getByText("Legacy Phone")).toBeTruthy();
    expect(screen.getByText("confidence: 91%")).toBeTruthy();
  });

  it("treats an empty products list as authoritative over an older best match", () => {
    render(
      <TaggingResultDisplay
        result={result({ products: [], productRecognition: product("Legacy Phone", 91) })}
      />,
    );

    expect(screen.queryByText("Legacy Phone")).toBeNull();
    expect(screen.getByText("noRecognizedFeatures")).toBeTruthy();
  });
});
