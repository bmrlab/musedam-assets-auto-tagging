import { describe, expect, it } from "vitest";

import {
  buildChildrenInclude,
  buildChildrenSelect,
  buildParentInclude,
  buildParentSelect,
  buildTagNamePath,
  findExceedingTagLevel,
  getTreeDepth,
  MAX_TAG_LEVEL,
} from "@/lib/tagging/tag-level";

type N = { name: string; verb?: "create" | "delete"; children?: N[] };
const chain = (names: string[], verb?: N["verb"]): N[] =>
  names.length === 0 ? [] : [{ name: names[0], verb, children: chain(names.slice(1), verb) }];

describe("tag-level helpers", () => {
  it("MAX_TAG_LEVEL is 4", () => {
    expect(MAX_TAG_LEVEL).toBe(4);
  });

  it("builds recursive children include / select of the given depth", () => {
    const orderBy = { sort: "desc" };
    expect(buildChildrenInclude(2, { orderBy })).toEqual({
      children: { orderBy, include: { children: { orderBy } } },
    });
    expect(buildChildrenInclude(0)).toBeUndefined();
    expect(buildChildrenSelect(2, { id: true }, { where: { taggingEnabled: true } })).toEqual({
      children: {
        where: { taggingEnabled: true },
        select: { id: true, children: { where: { taggingEnabled: true }, select: { id: true } } },
      },
    });
    // 默认从一级节点覆盖到 MAX_TAG_LEVEL
    let depth = 0;
    let node = buildChildrenInclude();
    while (node) {
      depth++;
      node = node.children.include;
    }
    expect(depth).toBe(MAX_TAG_LEVEL - 1);
  });

  it("builds recursive parent include / select and walks the chain into a path", () => {
    expect(buildParentInclude(2)).toEqual({ parent: { include: { parent: true } } });
    expect(buildParentSelect({ name: true }, 2)).toEqual({
      parent: { select: { name: true, parent: { select: { name: true } } } },
    });
    expect(
      buildTagNamePath({
        name: "SU7",
        parent: {
          name: "小米汽车",
          parent: { name: "品牌", parent: { name: "车型信息", parent: null } },
        },
      }),
    ).toEqual(["车型信息", "品牌", "小米汽车", "SU7"]);
  });

  it("detects trees deeper than MAX_TAG_LEVEL", () => {
    const getChildren = (n: N) => n.children;
    expect(getTreeDepth(chain(["a", "b", "c", "d"]))).toBe(4);
    expect(findExceedingTagLevel(chain(["a", "b", "c", "d"]), getChildren)).toBeNull();
    expect(findExceedingTagLevel(chain(["a", "b", "c", "d", "e"]), getChildren)).toBe(5);
    // 挂到第 2 级下：3 层子树已经到第 4 级，4 层子树超限
    expect(findExceedingTagLevel(chain(["b", "c", "d"]), getChildren, { baseLevel: 2 })).toBeNull();
    expect(findExceedingTagLevel(chain(["b", "c", "d", "e"]), getChildren, { baseLevel: 2 })).toBe(
      5,
    );
    // 删除的子树不计；未新建的已有节点不报错
    const tree: N[] = [
      { name: "a", children: [{ name: "b", children: chain(["c", "d", "e"], "delete") }] },
    ];
    expect(
      findExceedingTagLevel(tree, getChildren, { isCounted: (n) => n.verb !== "delete" }),
    ).toBeNull();
    expect(
      findExceedingTagLevel(chain(["a", "b", "c", "d", "e"]), getChildren, {
        isChecked: (n) => n.verb === "create",
      }),
    ).toBeNull();
  });
});
