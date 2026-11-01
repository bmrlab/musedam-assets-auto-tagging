import { planFeatureTagRelinks } from "@/lib/tagging/relink-feature-tags";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: {} }));

const tags = [
  { id: 10, name: "品牌", parentId: null },
  { id: 11, name: "兰芝", parentId: 10 },
  { id: 12, name: "雪纱系列", parentId: 11 },
  { id: 20, name: "分类", parentId: null },
  { id: 21, name: "雪纱系列", parentId: 20 },
];
const link = (tagPath: unknown, assetTagId: number | null = null, id = "link") => ({
  id,
  featureId: "product",
  tagPath,
  assetTagId,
});

describe("feature tag relink planning", () => {
  it("restores a deleted tag by its full path, not its leaf name", () => {
    expect(planFeatureTagRelinks(tags, [link(["品牌", "兰芝", "雪纱系列"])])[0]).toMatchObject({
      status: "relink",
      oldTagId: null,
      newTagId: 12,
    });
    expect(planFeatureTagRelinks(tags, [link(["雪纱系列"])])[0].status).toBe("not_found");
  });
  it("preserves valid IDs even if the cached path is stale; repeated execution is a no-op", () => {
    expect(planFeatureTagRelinks(tags, [link(["old name"], 12)])[0].status).toBe("unchanged");
    expect(planFeatureTagRelinks(tags, [link(["品牌", "兰芝", "雪纱系列"], 12)])[0].status).toBe(
      "unchanged",
    );
  });
  it("does not guess missing, malformed, or ambiguous paths", () => {
    const ambiguous = [...tags, { id: 99, name: "品牌", parentId: null }];
    expect(
      planFeatureTagRelinks(ambiguous, [
        link(["品牌"]),
        link([]),
        link([1]),
        link("品牌"),
        link([" 品牌"]),
      ]).map((r) => r.status),
    ).toEqual(["ambiguous", "invalid_path", "invalid_path", "invalid_path", "not_found"]);
  });
  it("does not violate feature/tag uniqueness with existing or planned links", () => {
    const path = ["品牌", "兰芝", "雪纱系列"];
    expect(
      planFeatureTagRelinks(tags, [link(path), link(path, 12, "existing")]).map((r) => r.status),
    ).toEqual(["duplicate", "unchanged"]);
    expect(
      planFeatureTagRelinks(tags, [link(path), link(path, null, "second")]).map((r) => r.status),
    ).toEqual(["relink", "duplicate"]);
    expect(
      planFeatureTagRelinks(tags, [link(path), { ...link(path), featureId: "other" }]).map(
        (r) => r.status,
      ),
    ).toEqual(["relink", "relink"]);
  });
  it("excludes broken and cyclic trees and distinguishes names containing separators", () => {
    const malformed = [
      { id: 1, name: "broken", parentId: 999 },
      { id: 2, name: "cycle", parentId: 2 },
      { id: 3, name: "a > b", parentId: null },
    ];
    expect(
      planFeatureTagRelinks(malformed, [
        link(["broken"]),
        link(["cycle"]),
        link(["a", "b"]),
        link(["a > b"]),
      ]).map((r) => r.status),
    ).toEqual(["not_found", "not_found", "not_found", "relink"]);
  });
});
