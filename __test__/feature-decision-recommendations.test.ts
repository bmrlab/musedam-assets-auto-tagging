// @vitest-environment node
import type { AssetFeatureClassification } from "@/lib/feature-decision/classify";
import { buildFeatureRecommendations } from "@/lib/feature-decision/recommendations";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { logoTags } = vi.hoisted(() => ({ logoTags: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { assetLogoTag: { findMany: logoTags } } }));

function classification(): AssetFeatureClassification {
  const common = { similarity: 0.6, confidence: 93, detectionIndex: 0 };
  return {
    brand: {
      topMatches: [],
      matches: [
        { ...common, assetLogoId: "logo-a", logoName: "A", logoTypeId: null, logoTypeName: "Logo" },
      ],
      bestMatch: null,
      noConfidentMatch: false,
      winningDetectionIndex: null,
    },
    ip: {
      topMatches: [],
      matches: [
        {
          ...common,
          assetIpId: "ip-a",
          ipName: "IP A",
          ipTypeId: null,
          ipTypeName: "IP",
          description: "",
          imageSimilarity: 0.6,
          descriptionSimilarity: 0,
          recommendedTags: [{ id: "ip-tag", assetTagId: 2, tagPath: ["IP A"] }],
        },
      ],
      bestMatch: null,
      noConfidentMatch: false,
      winningDetectionIndex: null,
    },
    product: null,
    diagnostics: {
      mode: "llm",
      ocr: { status: "empty", segments: [] },
      decision: { status: "completed", result: { outcome: "matched", matches: [] } },
      retrieval: {
        regionsDetected: 2,
        regionsSelected: 2,
        regionsDeduplicated: 0,
        regionsOmitted: 0,
        candidatesRetrieved: 2,
        unassessedCandidates: [],
        errors: [],
      },
    },
  };
}
beforeEach(() => vi.resetAllMocks());

describe("final recommendation mapping", () => {
  it("retains per-identity LLM confidence and loads only accepted logo tags", async () => {
    logoTags.mockResolvedValue([{ assetLogoId: "logo-a", assetTagId: 1, tagPath: ["A"] }]);
    const result = await buildFeatureRecommendations(classification());
    expect(logoTags.mock.calls[0][0].where.assetLogoId.in).toEqual(["logo-a"]);
    expect(result.brandRecommendation).toMatchObject({
      decisionSource: "llm",
      bestMatch: { confidence: 93, similarity: 0.6 },
      recommendedTags: [{ assetTagId: 1, tagPath: ["A"] }],
    });
    expect(result.ipRecommendation?.recommendedTags).toEqual([
      { assetTagId: 2, tagPath: ["IP A"] },
    ]);
  });

  it("retains independent recommendations and diagnostics if a logo tag lookup fails", async () => {
    logoTags.mockRejectedValue(new Error("logo tags unavailable"));
    const input = classification();
    const result = await buildFeatureRecommendations(input);
    expect(result.brandRecommendation?.recommendedTags).toEqual([]);
    expect(result.ipRecommendation?.matches?.map((match) => match.assetIpId)).toEqual(["ip-a"]);
    expect(input.diagnostics.retrieval?.errors).toEqual([
      "logo linked tags: logo tags unavailable",
    ]);
  });

  it("does not resurrect a retrieval winner when the final matches array is empty", async () => {
    const input = classification();
    input.brand!.bestMatch = input.brand!.matches![0];
    input.brand!.matches = [];
    const result = await buildFeatureRecommendations(input);
    expect(logoTags).not.toHaveBeenCalled();
    expect(result.brandRecommendation).toMatchObject({
      matches: [],
      bestMatch: null,
      recommendedTags: [],
      noConfidentMatch: true,
    });
  });
});
