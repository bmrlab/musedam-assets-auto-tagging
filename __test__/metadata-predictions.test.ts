import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { resolveMetadataPredictions, type RawMetadataPrediction } from "@/lib/metadata/predictions";
import type { MetadataContext } from "@/lib/metadata/types";
import { describe, expect, it } from "vitest";
const context: MetadataContext = {
  enabled: true,
  materialId: "1",
  version: 0,
  fields: [
    {
      fieldId: "f",
      fieldVersion: 2,
      name: "Channel",
      type: "single_select",
      multiple: false,
      options: [
        { id: "a", label: "Retail" },
        { id: "b", label: "Online" },
      ],
    },
    {
      fieldId: "bool",
      fieldVersion: 1,
      name: "Checked",
      type: "boolean",
      multiple: false,
      options: [],
    },
  ],
};
const raw = (change: Partial<RawMetadataPrediction> = {}): RawMetadataPrediction => ({
  fieldId: "f",
  optionIds: ["a"],
  source: "basicInfo",
  confidence: 0.9,
  evidence: "Retail",
  ...change,
});
const resolve = (rows: RawMetadataPrediction[], settings = DEFAULT_TAGGING_SETTINGS) =>
  resolveMetadataPredictions(
    context,
    rows,
    { basicInfo: "Retail Online unchecked", contentAnalysis: "Retail" },
    settings,
  );
describe("metadata closed-world prediction", () => {
  it("rejects invented IDs, cross-field IDs, absent sources and fabricated evidence", () => {
    expect(
      resolve([
        raw({ optionIds: ["unknown"] }),
        raw({ fieldId: "unknown" }),
        raw({ evidence: "not in input" }),
        raw({ source: "materializedPath" }),
      ]),
    ).toEqual([]);
  });
  it("does not accept multiple choices for a single-value field", () =>
    expect(resolve([raw({ optionIds: ["a", "b"] })])).toEqual([]));
  it("preserves an evidenced false checkbox", () => {
    const [item] = resolve([
      raw({ fieldId: "bool", optionIds: [], checked: false, evidence: "unchecked" }),
    ]);
    expect(item.checked).toBe(false);
    expect(item.effective).toBe(true);
  });
  it("retains alternative single values as candidates, only the highest can take effect", () => {
    const rows = resolve([raw(), raw({ optionIds: ["b"], confidence: 0.85, evidence: "Online" })]);
    expect(rows.map((r) => r.effective)).toEqual([true, false]);
  });
  it("uses precise/balanced/broad thresholds and team source weights", () => {
    const rows = [raw({ confidence: 0.6 })];
    expect(
      resolve(rows, { ...DEFAULT_TAGGING_SETTINGS, recognitionAccuracy: "precise" })[0].effective,
    ).toBe(false);
    expect(resolve(rows)[0].effective).toBe(true);
    expect(
      resolve(rows, {
        ...DEFAULT_TAGGING_SETTINGS,
        sourceWeights: { ...DEFAULT_TAGGING_SETTINGS.sourceWeights, basicInfo: 2 },
      })[0].score,
    ).toBeGreaterThan(resolve(rows)[0].score);
  });
  it("merges sources and never counts duplicate source predictions twice", () => {
    const one = resolve([raw()])[0];
    expect(resolve([raw(), raw()])[0].score).toBe(one.score);
    expect(
      resolve([raw({ confidence: 0.6 }), raw({ source: "contentAnalysis", confidence: 0.6 })])[0]
        .score,
    ).toBeGreaterThan(resolve([raw({ confidence: 0.6 })])[0].score);
  });
  it("combines independently evidenced multi-select options", () => {
    const multi = {
      ...context,
      fields: context.fields.map((f) =>
        f.fieldId === "f" ? { ...f, type: "multiple_select" as const, multiple: true } : f,
      ),
    };
    const rows = resolveMetadataPredictions(
      multi,
      [raw(), raw({ optionIds: ["b"], source: "contentAnalysis", evidence: "Online" })],
      { basicInfo: "Retail", contentAnalysis: "Online" },
      DEFAULT_TAGGING_SETTINGS,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].optionIds).toEqual(["a", "b"]);
  });
  it("keeps low-confidence predictions visible as candidates", () =>
    expect(resolve([raw({ confidence: 0.1 })])[0].effective).toBe(false));
});
