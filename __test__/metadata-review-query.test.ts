import {
  defaultMetadataReviewFilters as defaults,
  metadataReviewWhere,
} from "@/app/(tagging)/tagging/review/metadata-review-query";
import { describe, expect, it } from "vitest";
describe("metadata asset review filters", () => {
  it("always scopes the query to its authenticated team and selected review state", () => {
    expect(metadataReviewWhere(135, defaults)).toEqual({ teamId: 135, status: "pending", AND: [] });
    expect(metadataReviewWhere(135, { ...defaults, status: "all" })).not.toHaveProperty("status");
  });
  it("filters numeric confidence at the same 60/80 boundaries as the chips and filters source evidence", () => {
    expect(
      metadataReviewWhere(135, { ...defaults, confidence: "medium", source: "basicInfo" }).AND,
    ).toEqual([
      { prediction: { path: ["sources"], array_contains: [{ source: "basicInfo" }] } },
      { prediction: { path: ["score"], gte: 60, lt: 80 } },
    ]);
  });
  it("uses initiation time and literal search values without losing team isolation", () => {
    const where = metadataReviewWhere(
      135,
      { ...defaults, time: "week", search: "  100% test  " },
      new Date("2026-11-10T12:00:00Z"),
    );
    expect(where.teamId).toBe(135);
    expect(where.AND).toContainEqual({
      queueItem: { createdAt: { gte: new Date("2026-11-03T12:00:00Z") } },
    });
    expect(JSON.stringify(where)).toContain("100% test");
  });
  it("rejects unsupported filters and oversized searches", () => {
    expect(() => metadataReviewWhere(135, { ...defaults, source: "bad" as never })).toThrow(
      "Invalid query",
    );
    expect(() => metadataReviewWhere(135, { ...defaults, search: "a".repeat(201) })).toThrow(
      "Invalid query",
    );
  });
});
