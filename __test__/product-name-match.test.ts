import { matchProductsByAssetName } from "@/lib/product/product-name-match";
import { describe, expect, it } from "vitest";

const products = [
  { id: "short", name: "精华" },
  { id: "serum", name: "双萃精华" },
  { id: "sku", name: "KF12.0066" },
  { id: "sku2", name: "KF12.00661" },
];
const ids = (name: string, library = products) =>
  matchProductsByAssetName(name, library).map(({ id }) => id);

describe("complete product names in asset filenames", () => {
  it("finds Chinese names in a longer filename without selecting a contained shorter name", () => {
    expect(ids("品牌双萃精华415_注意图.jpg")).toEqual(["serum"]);
  });
  it("matches the reported lip tint filename despite spacing before its shade number", () => {
    const library = [
      { id: "415", name: "赫妍魅感裸透镜彩唇釉 415" },
      { id: "418", name: "赫妍魅感裸透镜彩唇釉 418" },
    ];
    expect(ids("赫妍魅感裸透镜彩唇釉415_试色图", library)).toEqual(["415"]);
    expect(ids("赫妍魅感裸透镜彩唇釉4150_试色图", library)).toEqual([]);
  });
  it("uses Latin model boundaries, escapes punctuation, and normalizes full-width characters", () => {
    expect(ids("shot_ＫＦ１２.００６６１.jpg")).toEqual(["sku2"]);
    expect(ids("KF12X0066.jpg")).toEqual([]);
    expect(ids("KF12.0066")).toEqual(["sku"]);
  });
  it("keeps separately mentioned products and deduplicates repeated names", () => {
    expect(ids("双萃精华_精华_KF12.0066_双萃精华.png")).toEqual(["short", "serum", "sku"]);
  });
  it("does not infer identity from duplicate library names or a shorter name contained in them", () => {
    expect(ids("双萃精华.jpg", [...products, { id: "duplicate", name: "双萃精华" }])).toEqual([]);
  });
  it("ignores file extensions, blank names, and single-character names", () => {
    expect(
      ids("photo.jpg", [
        { id: "extension", name: "JPG" },
        { id: "blank", name: " " },
        { id: "single", name: "p" },
      ]),
    ).toEqual([]);
  });
});
