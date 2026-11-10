import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { predictMetadata } from "@/lib/metadata/predict";
import type { MetadataContext, MetadataField, MetadataPrediction } from "@/lib/metadata/types";
import type { AssetObject } from "@/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: () => ({}) }));
vi.mock("@/app/(tagging)/predict", () => ({
  buildContentAnalysisText: () => "",
  getTaggingPredictProviderOptions: () => ({}),
  runWithTaggingModelFallback: (_: string, _team: number, fn: (model: string) => unknown) =>
    fn("test"),
}));
const { fetchContext, generate } = vi.hoisted(() => ({ fetchContext: vi.fn(), generate: vi.fn() }));
vi.mock("@/musedam/metadata", () => ({ fetchMetadataContext: fetchContext }));
vi.mock("ai", () => ({ generateObject: generate }));
const source: MetadataField = {
  fieldId: "source",
  fieldVersion: 1,
  name: "Source",
  type: "boolean",
  multiple: false,
  options: [],
};
const target: MetadataField = {
  fieldId: "target",
  fieldVersion: 1,
  name: "Target",
  type: "single_select",
  multiple: false,
  dependsOn: ["source"],
  options: [
    { id: "retail", label: "Retail" },
    { id: "online", label: "Online" },
  ],
};
const context = (fields: MetadataField[], rejectedFieldIds: string[] = []): MetadataContext => ({
  enabled: true,
  materialId: "42",
  version: 0,
  fields,
  rejectedFieldIds,
});
const asset = {
  slug: "a/42",
  name: "source online retail",
  description: "",
  content: {},
  extra: {},
  materializedPath: "",
} as unknown as AssetObject;
const settings = {
  ...DEFAULT_TAGGING_SETTINGS,
  recognitionAccuracy: "precise" as const,
  matchingSources: {
    basicInfo: true,
    contentAnalysis: false,
    materializedPath: false,
    tagKeywords: false,
  },
};
const raw = (fieldId: string, confidence = 1) => ({
  fieldId,
  checked: fieldId === "source" ? true : null,
  optionIds: fieldId === "target" ? ["online"] : [],
  source: "basicInfo",
  confidence,
  evidence: fieldId === "source" ? "source" : "online",
});
beforeEach(() => {
  fetchContext.mockReset();
  generate.mockReset();
});

describe("metadata linkage prediction stages", () => {
  it("identifies the source first and only sends restricted downstream options to the second model call", async () => {
    fetchContext
      .mockResolvedValueOnce(context([target, source]))
      .mockResolvedValue(context([source, { ...target, options: [target.options[1]] }]));
    generate
      .mockResolvedValueOnce({ object: { predictions: [raw("source")] } })
      .mockResolvedValueOnce({ object: { predictions: [raw("target")] } });
    const result = await predictMetadata(asset, { id: 1, slug: "t/135" }, settings);
    expect(result.map((p) => p.fieldId)).toEqual(["source", "target"]);
    expect(
      JSON.parse(generate.mock.calls[0][0].prompt).fields.map((f: MetadataField) => f.fieldId),
    ).toEqual(["source"]);
    expect(JSON.parse(generate.mock.calls[1][0].prompt).fields[0].options).toEqual([
      { id: "online", label: "Online" },
    ]);
    expect(fetchContext.mock.calls[1][2].map((p: MetadataPrediction) => p.fieldId)).toEqual([
      "source",
    ]);
  });
  it("does not ask the model to overwrite a downstream value supplied by FILL", async () => {
    fetchContext
      .mockResolvedValueOnce(context([source, target]))
      .mockResolvedValue(context([source]));
    generate.mockResolvedValue({ object: { predictions: [raw("source")] } });
    const result = await predictMetadata(asset, { id: 1, slug: "t/135" }, settings);
    expect(result.map((p) => p.fieldId)).toEqual(["source"]);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("keeps low-confidence candidates out of the rule preview", async () => {
    fetchContext.mockResolvedValue(context([source, target]));
    generate
      .mockResolvedValueOnce({ object: { predictions: [raw("source", 0.7)] } })
      .mockResolvedValueOnce({ object: { predictions: [raw("target")] } });
    const result = await predictMetadata(asset, { id: 1, slug: "t/135" }, settings);
    expect(fetchContext.mock.calls[1][2]).toEqual([]);
    expect(result.find((p) => p.fieldId === "source")?.effective).toBe(false);
  });
  it("removes a source suggestion rejected by the latest protected-value constraints", async () => {
    fetchContext
      .mockResolvedValueOnce(context([source]))
      .mockResolvedValue(context([source], ["source"]));
    generate.mockResolvedValue({ object: { predictions: [raw("source")] } });
    expect(await predictMetadata(asset, { id: 1, slug: "t/135" }, settings)).toEqual([]);
  });
  it("fails closed on a cyclic dependency instead of predicting unrestricted values", async () => {
    fetchContext.mockResolvedValue(context([{ ...source, dependsOn: ["target"] }, target]));
    await expect(predictMetadata(asset, { id: 1, slug: "t/135" }, settings)).rejects.toThrow(
      "dependency cycle",
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
