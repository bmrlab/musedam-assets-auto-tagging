import { buildFeatureDecisionPrompt } from "@/lib/feature-decision/prompts";
import type { FeatureDecisionCandidate } from "@/lib/feature-decision/types";
import { describe, expect, it } from "vitest";

const logo = (id: string): FeatureDecisionCandidate => ({
  candidateId: `logo:${id}`, classId: id, featureType: "logo", name: id, typeName: "Logo",
  similarity: 0.8, referenceImage: "sheet", referenceImageCount: 28,
  referenceImageIds: ["internal-image-id"], description: "素材中包含HERA文字的都需要识别到该特征",
});
const product: FeatureDecisionCandidate = {
  candidateId: "product:cream", classId: "cream", featureType: "product", name: "Irrelevant Product Specification",
  typeName: "Product", similarity: 0.9, referenceImage: "product", notes: "Distinctive product variant",
  regionIds: ["product:0"],
};
function messages(candidates: FeatureDecisionCandidate[], imageMode = true) {
  return buildFeatureDecisionPrompt({ sourceImage: "whole-source", imageMode,
    fileName: "source.jpg", folderPath: "/campaign", ocr: { status: "completed", segments: ["visible source OCR"] },
    candidates, contextCandidates: [logo("hera"), logo("other"), product] }).messages;
}
function payload(value: ReturnType<typeof messages>) {
  const c = value[1].content;
  const text = typeof c === "string" ? c : c.find(part => part.type === "text")!.text;
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}
describe("logo-only prompt budget", () => {
  it("keeps logo cross-batch context, source evidence and variants while excluding unrelated product data", () => {
    const m = messages([logo("hera")]);
    const p = payload(m);
    expect(p.candidates[0].description).toContain("HERA");
    expect(p.candidates[0].retrieval.referenceImageCount).toBe(28);
    expect(p.otherCatalogCandidates.map((c: { name: string }) => c.name)).toEqual(["other"]);
    expect(p.ocr.segments).toEqual(["visible source OCR"]);
    expect(p.fileName).toBe("source.jpg");
    expect(p).not.toHaveProperty("sourceRegions");
    expect(JSON.stringify(m)).not.toContain("Irrelevant Product Specification");
    expect(JSON.stringify(m)).not.toContain("internal-image-id");
    expect(String(m[0].content).length).toBeLessThan(String(messages([logo("hera"), product])[0].content).length * 0.5);
  });
  it("retains full product competition context for mixed batches", () => {
    const p = payload(messages([logo("hera"), product]));
    expect(p.sourceRegions.some((r: { featureType: string }) => r.featureType === "product")).toBe(true);
    expect(p.candidates[1]).toMatchObject({ candidateId: "C2", name: product.name });
  });
  it("does not attach source or reference images in the compact text-only mode", () => {
    const m = messages([logo("hera")], false);
    expect(m.every(v => typeof v.content === "string")).toBe(true);
    expect(m[0].content).toContain("TEXT ONLY");
    expect(JSON.stringify(m)).not.toContain("whole-source");
    expect(JSON.stringify(m)).not.toContain('"image_url"');
    expect(JSON.stringify(m)).not.toContain('"visual"');
  });
});
