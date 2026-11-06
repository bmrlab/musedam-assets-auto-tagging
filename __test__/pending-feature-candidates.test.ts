import type { ReviewFeature } from "@/app/(tagging)/tagging/review/feature-review";
import { pendingFeatureCandidates } from "@/app/(tagging)/tagging/review/pending-feature-candidates";
import { describe, expect, it } from "vitest";
const thresholds = { brand: 60, product: 60, ip: 60, person: 60 };
const feature: ReviewFeature = {
  id: "cream",
  featureType: "product",
  name: "Cream (rich)",
  typeId: null,
  typeName: "Product",
  tags: [],
};
const match = {
  candidateId: "product:cream",
  confidence: 88,
  reason: "Cream identified",
  evidence: ["retrieval"],
  conflicts: [],
  specificityLimit: "Rich variant unresolved",
};
const result = {
  featureDecision: { decision: { status: "completed", result: { matches: [match] } } },
  productRecommendation: { matches: [] },
};
describe("read-only pending feature candidates", () => {
  it("shows a high scoring real variant ambiguity without promoting it to accepted matches", () => {
    expect(
      pendingFeatureCandidates(1, result, new Map([["product:cream", feature]]), thresholds),
    ).toEqual([
      {
        queueItemId: 1,
        key: "product:cream",
        name: feature.name,
        confidence: 88,
        reasons: ["Rich variant unresolved"],
        evidence: ["retrieval"],
        reason: "Cream identified",
      },
    ]);
    expect(result.productRecommendation.matches).toEqual([]);
  });
  it("excludes low scores, unavailable features, and already accepted identities", () => {
    expect(pendingFeatureCandidates(1, result, new Map(), thresholds)).toEqual([]);
    expect(
      pendingFeatureCandidates(1, result, new Map([["product:cream", feature]]), {
        ...thresholds,
        product: 90,
      }),
    ).toEqual([]);
    const accepted = {
      ...result,
      productRecommendation: { matches: [{ assetProductId: "cream", confidence: 88 }] },
    };
    expect(
      pendingFeatureCandidates(1, accepted, new Map([["product:cream", feature]]), thresholds),
    ).toEqual([]);
  });
});
