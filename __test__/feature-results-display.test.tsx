import {
  getTaggingResultFeatureKeys,
  TaggingResultDisplay,
  type BrandRecognitionResult,
  type IpRecognitionResult,
  type TaggingResult,
} from "@/app/(tagging)/tagging/test/components/TaggingResultDisplay";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui", () => ({ TagOutlinedIcon: () => null, VimIcon: () => null }));
vi.mock("@/hooks/use-feature-library", () => ({
  useFeatureLibraryFeatures: () => ({
    featureProduct: false,
    featureBrand: true,
    featureIp: true,
    featurePerson: false,
  }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(tagging)/tagging/test/components/FeatureThumbnail", () => ({
  FeatureThumbnail: () => null,
}));

function brand(name: string, confidence: number): BrandRecognitionResult {
  return {
    noConfidentMatch: false,
    logoName: name,
    logoTypeName: "Logo",
    confidence,
    similarity: 0.99,
    assetLogoId: name,
    recommendedTags: [{ tagPath: ["Logo", name] }],
  };
}
function ip(name: string, confidence: number): IpRecognitionResult {
  return {
    noConfidentMatch: false,
    ipName: name,
    ipTypeName: "IP",
    confidence,
    similarity: 0.99,
    imageSimilarity: 0.98,
    descriptionSimilarity: 0,
    assetIpId: name,
    recommendedTags: [{ tagPath: ["IP", name] }],
  };
}
function result(overrides: Partial<TaggingResult>): TaggingResult {
  return {
    asset: {
      id: "1",
      name: "Asset",
      extension: "jpg",
      size: 1,
      categories: [],
      processingTime: 1,
      recognitionMode: "balanced",
    },
    overallScore: 95,
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

describe("multiple logo and IP feature results", () => {
  it("shows every accepted logo/IP with its own confidence and linked tags", () => {
    render(
      <TaggingResultDisplay
        result={result({
          brands: [brand("Brand A", 95), brand("Brand B", 60), brand("Weak brand", 59)],
          ips: [ip("Character X", 94), ip("Character Y", 60), ip("Weak IP", 59)],
        })}
      />,
    );
    for (const name of ["Brand A", "Brand B", "Character X", "Character Y"])
      expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText("Logo > Brand B")).toBeTruthy();
    expect(screen.getByText("IP > Character Y")).toBeTruthy();
    expect(screen.getAllByText("confidence: 60%")).toHaveLength(2);
    expect(screen.queryByText("Weak brand")).toBeNull();
    expect(screen.queryByText("Weak IP")).toBeNull();
  });

  it("treats empty final lists as authoritative for display and thumbnail lookup", () => {
    const empty = result({
      brands: [],
      ips: [],
      brandRecognition: brand("Rejected brand", 99),
      ipRecognition: ip("Rejected IP", 99),
    });
    render(<TaggingResultDisplay result={empty} />);
    expect(screen.queryByText("Rejected brand")).toBeNull();
    expect(screen.queryByText("Rejected IP")).toBeNull();
    expect(getTaggingResultFeatureKeys(empty)).toEqual([]);
    expect(screen.getByText("noRecognizedFeatures")).toBeTruthy();
  });

  it("preserves historical single-identity display and includes all new thumbnail IDs", () => {
    render(
      <TaggingResultDisplay
        result={result({
          brandRecognition: brand("Legacy brand", 90),
          ipRecognition: ip("Legacy IP", 90),
        })}
      />,
    );
    expect(screen.getByText("Legacy brand")).toBeTruthy();
    expect(screen.getByText("Legacy IP")).toBeTruthy();
    expect(
      getTaggingResultFeatureKeys(
        result({ brands: [brand("a", 95), brand("b", 90)], ips: [ip("x", 90), ip("y", 81)] }),
      ),
    ).toEqual(["brand:a", "brand:b", "ip:x", "ip:y"]);
  });
});
