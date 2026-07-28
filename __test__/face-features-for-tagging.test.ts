import {
  buildFaceFeaturesPromptSection,
  collectPeopleCountTagPaths,
  isPeopleCountTagPath,
} from "@/app/(tagging)/face-features";
import type { TagWithChildren } from "@/prisma/client";
import { describe, expect, it } from "vitest";

describe("buildFaceFeaturesPromptSection", () => {
  it("omits the section when face features are unavailable", () => {
    expect(buildFaceFeaturesPromptSection(undefined)).toBe("");
  });

  it("asks the LLM to choose among available people-count tags", () => {
    const section = buildFaceFeaturesPromptSection({ faceCount: 3, found: true }, [
      ["Safety", "People Count", "1 Person"],
      ["Safety", "People Count", "3 People"],
      ["Safety", "People Count", "5+ Group Photo"],
    ]);
    expect(section).toContain("人物数量：3");
    expect(section).toContain("faceCount 作为人物总数");
    expect(section).toContain("由你判断");
    expect(section).toContain("Safety > People Count > 3 People");
    expect(section).toContain("5+ Group Photo");
    expect(section).not.toContain("硬约束");
  });
});

describe("collectPeopleCountTagPaths", () => {
  const tagsTree = [
    {
      id: 1,
      name: "Safety",
      extra: null,
      children: [
        {
          id: 2,
          name: "People Count",
          extra: null,
          children: [
            { id: 10, name: "1 Person", extra: null, children: [] },
            { id: 11, name: "3 People", extra: null, children: [] },
            { id: 12, name: "5+ Group Photo", extra: null, children: [] },
          ],
        },
      ],
    },
    {
      id: 3,
      name: "Event Type",
      extra: null,
      children: [{ id: 4, name: "Sports", extra: null, children: [] }],
    },
  ] as TagWithChildren[];

  it("collects only people-count leaves for the LLM", () => {
    expect(collectPeopleCountTagPaths(tagsTree)).toEqual([
      ["Safety", "People Count", "1 Person"],
      ["Safety", "People Count", "3 People"],
      ["Safety", "People Count", "5+ Group Photo"],
    ]);
  });

  it("detects people-count paths", () => {
    expect(isPeopleCountTagPath(["Safety", "People Count", "5+ Group Photo"])).toBe(true);
    expect(isPeopleCountTagPath(["Event Type", "Sports"])).toBe(false);
  });
});
