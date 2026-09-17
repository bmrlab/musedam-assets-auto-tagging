import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBrandRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getProductRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { createBatchTagsTreeLoader } from "@/app/(tagging)/queue";
import { FEATURE_CONFIDENCE_MIN } from "@/lib/tagging/feature-confidence";

vi.mock("@/prisma/prisma", () => ({ default: {} }));

function recommendation(confidence: number) {
  return {
    bestMatch: { confidence },
    recommendedTags: [{ assetTagId: 10 }, { assetTagId: 11 }],
  };
}

describe("direct mode feature-library thresholds (shared with review path)", () => {
  it("brand: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.brand;
    expect(
      getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: recommendation(min - 1) }),
    ).toEqual([]);
    expect(
      getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: recommendation(min) }),
    ).toEqual([10, 11]);
  });

  it("ip: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.ip;
    expect(getIpRecommendationTagIdsFromQueueResult({ ipRecommendation: recommendation(min - 1) })).toEqual(
      [],
    );
    expect(getIpRecommendationTagIdsFromQueueResult({ ipRecommendation: recommendation(min) })).toEqual([
      10, 11,
    ]);
  });

  it("product: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.product;
    expect(
      getProductRecommendationTagIdsFromQueueResult({ productRecommendation: recommendation(min - 1) }),
    ).toEqual([]);
    expect(
      getProductRecommendationTagIdsFromQueueResult({ productRecommendation: recommendation(min) }),
    ).toEqual([10, 11]);
  });

  it("null recommendation yields no tag ids", () => {
    expect(getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: null })).toEqual([]);
  });
});

describe("createBatchTagsTreeLoader", () => {
  it("loads each team's tag tree once per batch, even under concurrent calls", async () => {
    const load = vi.fn(async (teamId: number) => [{ id: teamId, name: `t${teamId}`, extra: null }]);
    const loader = createBatchTagsTreeLoader(load);

    const [a, b, c] = await Promise.all([loader(1), loader(1), loader(2)]);

    expect(load).toHaveBeenCalledTimes(2);
    expect(a).toBe(b);
    expect(c[0].id).toBe(2);
  });

  it("does not cache a failed load, so the next call retries", async () => {
    let calls = 0;
    const load = vi.fn(async (teamId: number) => {
      calls++;
      if (calls === 1) throw new Error("db down");
      return [{ id: teamId, name: "ok", extra: null }];
    });
    const loader = createBatchTagsTreeLoader(load);

    await expect(loader(1)).rejects.toThrow("db down");
    await expect(loader(1)).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
