// @vitest-environment node
import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { predictMetadata } from "@/lib/metadata/predict";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: {} }));
vi.mock("@/musedam/metadata", () => ({
  fetchMetadataContext: async () => ({
    enabled: true, materialId: "42", version: 1,
    fields: [
      { fieldId: "channel", fieldVersion: 1, name: "销售渠道", type: "single_select", multiple: false,
        options: [{ id: "retail", label: "线下门店" }, { id: "online", label: "线上电商" }] },
      { fieldId: "season", fieldVersion: 1, name: "适用季节", type: "multiple_select", multiple: true,
        options: ["春季", "夏季", "秋季", "冬季"].map((label, i) => ({ id: `season-${i}`, label })) },
      { fieldId: "person", fieldVersion: 1, name: "含人物", type: "boolean", multiple: false,
        instruction: "不含人物对应 false，含人物对应 true；没有证据时不要返回。", options: [] },
      { fieldId: "category", fieldVersion: 1, name: "产品分类", type: "cascade", multiple: false,
        options: [{ id: "serum", label: "护肤/精华" }, { id: "cream", label: "护肤/面霜" }, { id: "lipstick", label: "彩妆/口红" }] },
    ],
  }),
}));

const cases = [
  { filename: "01-线下门店-海报-不含人物.txt", channel: "retail", seasons: ["season-0", "season-1"], person: false, category: "serum" },
  { filename: "02-线上电商-视频-含人物.txt", channel: "online", seasons: ["season-2", "season-3"], person: true, category: "lipstick" },
  { filename: "03-多渠道-海报.txt", channel: undefined, seasons: ["season-0", "season-2"], person: false, category: "cream" },
  { filename: "04-无依据.txt", channel: undefined, seasons: [], person: undefined, category: undefined },
];

describe.skipIf(process.env.METADATA_MODEL_SMOKE !== "true")("synthetic metadata cases with the configured model", () => {
  it.each(cases)("predicts supported fields for $filename", async (sample) => {
    const description = readFileSync(new URL(`../development/metadata-test-data/${sample.filename}`, import.meta.url), "utf8");
    const predictions = await predictMetadata({
      id: 42, teamId: 1, slug: "a/42", name: "META-20261110", description,
      materializedPath: "", tags: [], content: {}, extra: {}, createdAt: new Date(), updatedAt: new Date(),
    }, { id: 1, slug: "t/1" }, {
      ...DEFAULT_TAGGING_SETTINGS, isMetadataEnabled: true,
      matchingSources: { basicInfo: true, materializedPath: false, contentAnalysis: false, tagKeywords: false },
    });
    const field = (id: string) => predictions.find(p => p.fieldId === id);
    expect(field("channel")?.optionIds).toEqual(sample.channel ? [sample.channel] : undefined);
    expect([...(field("season")?.optionIds ?? [])].sort()).toEqual([...sample.seasons].sort());
    expect(field("person")?.checked).toBe(sample.person);
    expect(field("category")?.optionIds).toEqual(sample.category ? [sample.category] : undefined);
    for (const result of predictions) {
      expect(result.expectedFieldVersion).toBe(1);
      expect(result.sources.every(source => source.source === "basicInfo" && description.includes(source.evidence))).toBe(true);
    }
    if (sample.person === undefined) expect(predictions).toEqual([]);
  }, 120000);
});
