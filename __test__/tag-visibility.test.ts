import { getTagVisibilityPreview } from "@/app/tags/tagVisibility";
import { describe, expect, it } from "vitest";

describe("getTagVisibilityPreview", () => {
  it("returns an empty preview when no scope is selected", () => {
    expect(getTagVisibilityPreview([])).toEqual({ visibleItems: [], remainingCount: 0 });
  });

  it("shows two avatars and the remaining count", () => {
    expect(getTagVisibilityPreview(["Alice", "Design", "Reviewers"])).toEqual({
      visibleItems: ["Alice", "Design"],
      remainingCount: 1,
    });
  });
});
