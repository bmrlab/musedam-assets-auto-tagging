import {
  getReviewFeatures,
  hydrateReviewFeatures,
} from "@/app/(tagging)/tagging/review/feature-review";
import { getAcceptedBrandMatches } from "@/lib/feature-decision/match-policy";
import { normalizeFeatureThresholds } from "@/lib/tagging/feature-confidence";
import { rethresholdFeatures } from "@/lib/tagging/rethreshold-features";
import type { TaggingQueueItemResult } from "@/prisma/client";
import { describe, expect, it } from "vitest";
const thresholds = { brand: 70, product: 55, ip: 80, person: 60 };
function historical(): TaggingQueueItemResult {
  return {
    brandRecommendation: {
      matches: [],
      bestMatch: null,
      noConfidentMatch: true,
      recommendedTags: [],
    },
    featureDecision: {
      mode: "llm",
      decisionInputMode: "image",
      ocr: { status: "disabled", segments: [] },
      decision: {
        status: "completed",
        result: {
          outcome: "matched",
          matches: [
            {
              candidateId: "logo:one",
              confidence: 73,
              conflicts: [],
              evidence: ["visual"],
              specificityLimit: null,
              reason: "visible logo",
            },
          ],
        },
      },
    },
  };
}
describe("team thresholds on pending review evidence", () => {
  it("recovers a saved final decision below the old threshold without changing the stored history", () => {
    const source = historical();
    const result = rethresholdFeatures(source, thresholds);
    expect(getAcceptedBrandMatches(result.brandRecommendation).map((m) => m.assetLogoId)).toEqual([
      "one",
    ]);
    expect(source.brandRecommendation?.matches).toEqual([]);
    expect(
      rethresholdFeatures(source, { ...thresholds, brand: 74 }).brandRecommendation?.matches,
    ).toEqual([]);
  });
  it("hydrates recovered candidates only from available team-owned library entries", () => {
    const result = rethresholdFeatures(historical(), thresholds);
    expect(getReviewFeatures(hydrateReviewFeatures(result, new Map()))).toEqual([]);
    const library = new Map([
      [
        "brand:one",
        {
          featureType: "brand" as const,
          id: "one",
          name: "Logo",
          typeId: null,
          typeName: "Brand",
          tags: [{ assetTagId: 9, tagPath: ["Brand"] }],
        },
      ],
    ]);
    expect(getReviewFeatures(hydrateReviewFeatures(result, library))[0]?.tags).toEqual([
      { assetTagId: 9, tagPath: ["Brand"] },
    ]);
  });
  it.each(["conflict", "specificity", "evidence"])(
    "uses confidence alone for saved predictions containing %s notes",
    (kind) => {
      const source = historical();
      const diagnostics = source.featureDecision!;
      const match = diagnostics.decision.result!.matches[0];
      if (kind === "conflict") match.conflicts = ["different brand"];
      if (kind === "specificity") match.specificityLimit = "uncertain";
      if (kind === "evidence") match.evidence = ["filename"];
      expect(
        getAcceptedBrandMatches(
          rethresholdFeatures(source, { ...thresholds, brand: 0 }).brandRecommendation,
        ),
      ).toEqual([expect.objectContaining({ assetLogoId: "one", confidence: 73 })]);
    },
  );
  it("does not accept an incomplete model call even if a scored prediction was saved", () => {
    const source = historical();
    source.featureDecision!.decision.status = "failed";
    expect(getAcceptedBrandMatches(rethresholdFeatures(source, thresholds).brandRecommendation)).toEqual([]);
    source.featureDecision!.decision.status = "completed";
    source.featureDecision!.decision.error = "partial batch failure";
    expect(getAcceptedBrandMatches(rethresholdFeatures(source, thresholds).brandRecommendation)).toEqual([]);
  });

  it("never uses a retrieval-only product candidate as final confidence", () => {
    const source: TaggingQueueItemResult = {
      productRecommendation: {
        matches: [],
        bestMatch: null,
        noConfidentMatch: true,
        recommendedTags: [],
        detections: [
          {
            detectionIndex: 0,
            box: { xMin: 0, yMin: 0, xMax: 1, yMax: 1, score: 1, label: "product" },
            bestMatch: null,
            topMatches: [],
            noConfidentMatch: true,
          },
        ],
      },
    };
    expect(rethresholdFeatures(source, thresholds).productRecommendation?.matches).toEqual([]);
  });
  it("validates persisted settings and preserves defaults", () => {
    expect(normalizeFeatureThresholds({ brand: 70, ip: -1, person: "30", product: 1000 })).toEqual({
      brand: 70,
      ip: 60,
      person: 60,
      product: 60,
    });
  });
});


it("recovers scored product decisions outside the old region winner list and makes them reviewable", () => {
  const source = historical();
  source.featureDecision!.decision.result!.matches = [{
    candidateId: "product:cream", confidence: 75, reason: "Possible cream", evidence: ["retrieval"],
    conflicts: ["Brand text missing"], specificityLimit: "Variant uncertain",
  }];
  source.productRecommendation = { decisionSource: "llm", matches: [], bestMatch: null,
    noConfidentMatch: true, recommendedTags: [], detections: [{ detectionIndex: 0,
      box: { xMin: 0, yMin: 0, xMax: 1, yMax: 1, score: 1, label: "product" },
      bestMatch: null, topMatches: [], noConfidentMatch: true }],
  };
  const feature = { featureType: "product" as const, id: "cream", name: "Cream", typeId: null,
    typeName: "Product", tags: [{ assetTagId: 3, tagPath: ["Cream"] }] };
  const refreshed = rethresholdFeatures(source, { ...thresholds, product: 60 });
  expect(getReviewFeatures(hydrateReviewFeatures(refreshed, new Map([["product:cream", feature]]))))
    .toEqual([expect.objectContaining(feature)]);
  expect(source.productRecommendation.matches).toEqual([]);
});
