import { parseBatchTagText } from "@/app/tags/batchTagText";
import {
  flattenTagNodesToRows,
  getTagLevelHeaders,
  matrixToTagImportRows,
  nameChildListToBatchText,
  rowsToNameChildList,
} from "@/app/tags/tagImportExport";
import type { TagNode } from "@/app/tags/types";
import { describe, expect, it } from "vitest";

const node = (name: string, children: TagNode[] = []): TagNode => ({ name, slug: null, children });

describe("tag import/export preview", () => {
  it.each([3, 4] as const)("round-trips a %s-level tree into the editable preview", (level) => {
    const tree = [node("品牌", [node("Logo", [node("主视觉", [node("红色")])])])];
    const rows = flattenTagNodesToRows(tree, level);
    const matrix = [["说明行"], getTagLevelHeaders(level), ...rows];
    const imported = rowsToNameChildList(matrixToTagImportRows(matrix), level);
    const text = nameChildListToBatchText(imported, level);
    expect(rows).toEqual([["品牌", "Logo", "主视觉", ...(level === 4 ? ["红色"] : [])]]);
    expect(parseBatchTagText(text, level)).toEqual([
      {
        name: "品牌",
        nameChildList: [
          {
            name: "Logo",
            nameChildList: [
              { name: "主视觉", ...(level === 4 ? { nameChildList: [{ name: "红色" }] } : {}) },
            ],
          },
        ],
      },
    ]);
  });

  it("merges repeated paths in a file and keeps distinct branches", () => {
    const rows = matrixToTagImportRows([
      getTagLevelHeaders(3),
      ["品牌", "Logo", "红色"],
      ["品牌", "Logo", "红色"],
      ["品牌", "Logo", "蓝色"],
      ["产品", "Logo", "红色"],
    ]);
    const tree = rowsToNameChildList(rows, 3);
    expect(tree).toHaveLength(2);
    expect(tree[0].nameChildList).toHaveLength(1);
    expect(tree[0].nameChildList?.[0].nameChildList?.map((item) => item.name)).toEqual([
      "红色",
      "蓝色",
    ]);
    expect(tree[1].nameChildList?.[0].nameChildList?.[0].name).toBe("红色");
  });
});
