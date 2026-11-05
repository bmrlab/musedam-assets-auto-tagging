// @vitest-environment node
import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { predictMetadata } from "@/lib/metadata/predict";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/metadata", () => ({
  fetchMetadataContext: async () => ({
    enabled: true,
    materialId: "42",
    version: 0,
    fields: [
      {
        fieldId: "channel",
        fieldVersion: 2,
        name: "Sales channel",
        type: "single_select",
        instruction: "Use Retail when the asset is intended for retail stores.",
        multiple: false,
        options: [
          { id: "retail", label: "Retail" },
          { id: "online", label: "Online" },
        ],
      },
    ],
  }),
}));
vi.mock("@/prisma/prisma", () => ({ default: {} }));
describe.skipIf(process.env.METADATA_MODEL_SMOKE !== "true")(
  "configured model metadata smoke test",
  () => {
    it("selects a supplied stable ID using real structured model output and source evidence", async () => {
      const result = await predictMetadata(
        {
          id: 1,
          teamId: 1,
          slug: "a/42",
          name: "Retail store campaign poster",
          description: "This poster is for Retail stores.",
          materializedPath: "",
          tags: [],
          content: {},
          extra: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { id: 1, slug: "t/1" },
        {
          ...DEFAULT_TAGGING_SETTINGS,
          isMetadataEnabled: true,
          matchingSources: {
            basicInfo: true,
            materializedPath: false,
            contentAnalysis: false,
            tagKeywords: false,
          },
        },
      );
      expect(
        result.some(
          (item) =>
            item.fieldId === "channel" &&
            item.optionIds?.includes("retail") &&
            item.sources.every((source) => source.source === "basicInfo"),
        ),
      ).toBe(true);
    }, 120000);
  },
);
