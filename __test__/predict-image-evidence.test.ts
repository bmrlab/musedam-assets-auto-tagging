import { predictAssetTags } from "@/app/(tagging)/predict";
import type { AssetObject, TagWithChildren } from "@/prisma/client";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: (name: string) => ({ name }) }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()), generateObject: mocks.generate,
}));

const asset = {
  id: 1, teamId: 1, name: "应援自拍", description: "", materializedPath: "",
  content: { aiDescription: null, aiTitle: null, taskStatus: 0 }, extra: { extension: "gif" },
} as unknown as AssetObject;
const tree: TagWithChildren[] = [{ id: 1, name: "展示角度", extra: { evidencePolicy: "content" },
  children: [{ id: 2, name: "正面", extra: { evidencePolicy: "content" } }] }];
const sources = { basicInfo: true, materializedPath: true, contentAnalysis: true, tagKeywords: true };
const image = "data:image/jpeg;base64," + "a".repeat(130_000);
const prediction = () => ({ object: { predictions: [{ source: "contentAnalysis", tags: [
  { leafTagId: 2, tagPath: ["展示角度", "正面"], confidence: 0.95, evidence: "人物正面面向镜头" },
] }] }, usage: {} });
beforeEach(() => { mocks.generate.mockReset().mockResolvedValue(prediction()); });

it("uses bounded image evidence with no smart analysis, without charging base64 against the text budget or storing it", async () => {
  const loadImage = vi.fn().mockResolvedValue(image);
  const result = await predictAssetTags(asset, { tagsTree: tree, loadImage });
  expect(result.tagsWithScore.map(t => t.leafTagId)).toEqual([2]);
  expect(loadImage).toHaveBeenCalledTimes(1);
  const request = mocks.generate.mock.calls[0][0];
  expect(request.messages.at(-1).content).toContainEqual({ type: "image", image });
  expect(request.system).toContain("不要求先有文字版智能解析");
  expect(result.extra.tagImageEvidence).toEqual({ requested: true, used: true });
  expect(JSON.stringify(result.extra)).not.toContain("data:image");
});

it("does not load images when content analysis is explicitly disabled", async () => {
  const loadImage = vi.fn().mockResolvedValue(image);
  mocks.generate.mockResolvedValue({ object: { predictions: [{ source: "basicInfo", tags: [
    { leafTagId: 2, tagPath: ["展示角度", "正面"], confidence: 0.99, evidence: "正面" },
  ] }] }, usage: {} });
  const result = await predictAssetTags({ ...asset, name: "正面" }, {
    tagsTree: tree, loadImage, matchingSources: { ...sources, contentAnalysis: false },
  });
  expect(result.tagsWithScore).toHaveLength(1);
  expect(loadImage).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain("data:image");
});

it("falls back to text after image requests fail and records the actual mode", async () => {
  mocks.generate.mockImplementation(async args => {
    if (args.messages.some((m: { content: unknown }) => Array.isArray(m.content))) throw new Error("vision unavailable");
    return prediction();
  });
  const result = await predictAssetTags(asset, { tagsTree: tree, loadImage: async () => image });
  expect(result.extra.tagImageEvidence).toEqual({ requested: true, used: false, fallbackReason: "image_request_failed" });
  expect(mocks.generate.mock.calls.at(-1)![0].messages.every((m: { content: unknown }) => typeof m.content === "string")).toBe(true);
});

it("continues with text when image preparation fails", async () => {
  const result = await predictAssetTags(asset, { tagsTree: tree, loadImage: async () => { throw Error("download failed"); } });
  expect(result.extra.tagImageEvidence?.fallbackReason).toBe("image_preparation_failed");
  expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain("data:image");
});

it("keeps empty visual predictions on the visual path and lets the queue add deterministic tags", async () => {
  mocks.generate.mockResolvedValue({ object: { predictions: [] }, usage: {} });
  const result = await predictAssetTags(asset, { tagsTree: tree, loadImage: async () => image, allowEmptyResult: true });
  expect(result.tagsWithScore).toEqual([]);
  expect(mocks.generate).toHaveBeenCalledTimes(3);
  expect(result.extra.tagImageEvidence?.used).toBe(true);
  expect(mocks.generate.mock.calls.every(([r]) => r.schemaName === "TagPredictions")).toBe(true);
});

it("still requires literal evidence for literal labels in visual mode", async () => {
  const literalTree: TagWithChildren[] = [{ id: 3, name: "HERA", extra: { evidencePolicy: "literal" } }];
  mocks.generate.mockResolvedValue({ object: { predictions: [{ source: "contentAnalysis", tags: [
    { leafTagId: 3, tagPath: ["HERA"], confidence: 0.99, evidence: "人物穿着白色衣服" },
  ] }] }, usage: {} });
  const result = await predictAssetTags(asset, { tagsTree: literalTree, loadImage: async () => image, allowEmptyResult: true });
  expect(result.tagsWithScore).toEqual([]);
  mocks.generate.mockResolvedValue({ object: { predictions: [{ source: "contentAnalysis", tags: [
    { leafTagId: 3, tagPath: ["HERA"], confidence: 0.99, evidence: "HERA" },
  ] }] }, usage: {} });
  expect((await predictAssetTags(asset, { tagsTree: literalTree, loadImage: async () => image })).tagsWithScore).toHaveLength(1);
});

it("uses images to recall candidates from large trees before visual prediction", async () => {
  const tagsTree: TagWithChildren[] = [{ id: 1, name: "展示", extra: { evidencePolicy: "content" },
    children: Array.from({ length: 1200 }, (_, i) => ({ id: i + 2,
      name: i === 1199 ? "正面" : `tag_${i}`, extra: { evidencePolicy: "content" } })) }];
  mocks.generate.mockImplementation(async args => args.schemaName === "TagPredictions"
    ? { object: { predictions: [{ source: "contentAnalysis", tags: [
      { leafTagId: 1201, tagPath: ["展示", "正面"], confidence: 0.95, evidence: "正面人物" },
    ] }] }, usage: {} } : { object: { terms: ["正面"] } });
  const result = await predictAssetTags(asset, { tagsTree, loadImage: async () => image });
  expect(mocks.generate.mock.calls[0][0].messages[0].content).toContainEqual({ type: "image", image });
  expect(result.tagsWithScore.some(t => t.leafTagId === 1201)).toBe(true);
});
