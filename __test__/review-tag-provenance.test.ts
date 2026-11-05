import {
  createTagReviewSnapshot,
  getReviewTagSources,
} from "@/app/(tagging)/tagging/review/tag-review";
import { describe, expect, it } from "vitest";

describe("review tag provenance", () => {
  it("keeps preexisting tags existing and separates manual and AI additions", () => {
    const snapshot = createTagReviewSnapshot({
      existingTagSlugs: ["g/1", "g/4"],
      appliedTags: [1, 2, 3].map((id) => ({ id, slug: `g/${id}` })),
      manualTagIds: [1, 3],
    });
    expect(snapshot.sources).toEqual({
      "g/1": "existing",
      "g/2": "ai",
      "g/3": "manual",
      "g/4": "existing",
    });
  });

  it("does not guess sources without a pre-application baseline", () => {
    expect(
      createTagReviewSnapshot({
        existingTagSlugs: null,
        appliedTags: [{ id: 2, slug: "g/2" }],
        manualTagIds: [],
      }).sources,
    ).toEqual({});
    expect(getReviewTagSources([{}, null, { featureReview: {} }]).size).toBe(0);
  });

  it("preserves original sources across later reviews regardless of display order", () => {
    const first = {
      tagReview: {
        version: 1,
        reviewedAt: "2026-11-05T01:00:00Z",
        sources: { "g/1": "existing", "g/2": "ai", "g/3": "manual" },
      },
    };
    const second = {
      tagReview: {
        version: 1,
        reviewedAt: "2026-11-05T02:00:00Z",
        sources: { "g/2": "existing", "g/3": "existing", "g/4": "ai" },
      },
    };
    expect(Object.fromEntries(getReviewTagSources([second, first]))).toEqual({
      "g/1": "existing",
      "g/2": "ai",
      "g/3": "manual",
      "g/4": "ai",
    });
  });

  it("ignores malformed and unknown snapshot versions", () => {
    expect(
      getReviewTagSources([
        { tagReview: null },
        { tagReview: { version: 2, sources: {} } },
        { tagReview: { version: 1, reviewedAt: "now", sources: { "g/1": "rejected" } } },
      ]).size,
    ).toBe(0);
  });
});
