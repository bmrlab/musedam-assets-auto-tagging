import { recallProductsByMetadata } from "@/lib/product/metadata-candidates";
import { describe, expect, it } from "vitest";
const catalog = [
  { id: "set", name: "雪花秀御时参养水乳套装(1)", notes: "人参水乳", tags: [] },
  { id: "emulsion", name: "雪花秀滋盈琉光润颜乳(1)", notes: "琉光乳", tags: [] },
  { id: "water", name: "雪花秀滋盈琉光润颜水(1)", notes: "琉光水", tags: [] },
  { id: "other", name: "悦诗风吟眼霜", notes: "", tags: [] },
];
describe("product metadata candidate recall", () => {
  it("recalls both products in the reported series ahead of a brand-only set", () => {
    const hits = recallProductsByMetadata(catalog, {
      fileName: "Essential Revitalizing Emulsion EX_model 05",
      folderPath: "amore测试文件夹-du/雪花秀-琉光系列/美图",
    });
    expect(hits.map((hit) => hit.product.id)).toEqual(["emulsion", "water", "set"]);
    expect(hits[0].evidence).toContainEqual({ source: "path", terms: ["雪花秀", "琉光"] });
    expect(hits[0]).not.toHaveProperty("confidence");
  });
  it("uses filename aliases and linked series tags without inventing translations", () => {
    const products = [
      {
        id: "e",
        name: "雪花秀润颜乳",
        notes: "Essential Revitalizing Emulsion",
        tags: [{ tagPath: ["品牌产品线", "雪花秀", "滋盈琉光"] }],
      },
    ];
    const hit = recallProductsByMetadata(products, {
      fileName: "Essential Revitalizing Emulsion EX_model 05.jpg",
      folderPath: "琉光系列",
    })[0];
    expect(hit.evidence.map((e) => e.source)).toEqual(["filename", "path"]);
    expect(hit.evidence[0].terms).toContain("emulsion");
    expect(hit.evidence[1].terms).toContain("琉光");
  });
  it("ignores generic file/folder words and Latin substrings", () => {
    expect(
      recallProductsByMetadata([{ id: "p", name: "乳液套装", notes: "cream" }], {
        fileName: "screaming_model_05.jpg",
        folderPath: "测试文件夹/护肤/素材/美图",
      }),
    ).toEqual([]);
  });
  it("bounds candidate count and keeps deterministic ranking", () => {
    const products = Array.from({ length: 20 }, (_, i) => ({
      id: String(i).padStart(2, "0"),
      name: "雪花秀乳液",
    }));
    expect(recallProductsByMetadata(products, { folderPath: "雪花秀" })).toHaveLength(12);
    expect(recallProductsByMetadata(products, {})).toEqual([]);
  });
});

it("does not use a filename extension as catalog evidence", () => {
  expect(
    recallProductsByMetadata([{ id: "ext", name: "WEBP" }], { fileName: "photo.webp" }),
  ).toEqual([]);
});
