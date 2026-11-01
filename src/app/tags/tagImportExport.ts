import type { NameChildList } from "./batchTagText";
import type { TagNode } from "./types";

export const TAG_LEVEL_HEADERS_ZH = ["一级标签", "二级标签", "三级标签", "四级标签"] as const;
export const TAG_LEVEL_HEADERS_EN = [
  "Level 1 Tag",
  "Level 2 Tag",
  "Level 3 Tag",
  "Level 4 Tag",
] as const;

export type TagImportRow = Record<string, string>;

const normalizeHeader = (value: string) => value.replace(/\s+/g, "").toLowerCase();

const HEADER_ALIASES: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  TAG_LEVEL_HEADERS_ZH.forEach((h, i) => {
    map[normalizeHeader(h)] = i;
  });
  TAG_LEVEL_HEADERS_EN.forEach((h, i) => {
    map[normalizeHeader(h)] = i;
  });
  ["l1", "l2", "l3", "l4"].forEach((h, i) => {
    map[h] = i;
  });
  return map;
})();

export function getTagLevelHeaders(maxLevel: 3 | 4, langIsEn = false): string[] {
  const headers = langIsEn ? TAG_LEVEL_HEADERS_EN : TAG_LEVEL_HEADERS_ZH;
  return [...headers.slice(0, maxLevel)];
}

export function rowsToNameChildList(rows: TagImportRow[], maxLevel: 3 | 4): NameChildList[] {
  const root: NameChildList[] = [];

  const ensureChild = (siblings: NameChildList[], name: string): NameChildList => {
    let node = siblings.find((item) => item.name === name);
    if (!node) {
      node = { name, nameChildList: [] };
      siblings.push(node);
    }
    node.nameChildList ??= [];
    return node;
  };

  for (const row of rows) {
    const path = extractPathFromRow(row, maxLevel);
    if (!path.length) continue;
    let siblings = root;
    for (const name of path) {
      const node = ensureChild(siblings, name);
      siblings = node.nameChildList!;
    }
  }

  return root;
}

function extractPathFromRow(row: TagImportRow, maxLevel: 3 | 4): string[] {
  const cells = Array(maxLevel).fill("") as string[];
  Object.entries(row).forEach(([key, value]) => {
    const index = HEADER_ALIASES[normalizeHeader(String(key))];
    if (index === undefined || index >= maxLevel) return;
    cells[index] = String(value ?? "").trim();
  });
  const path: string[] = [];
  for (let i = 0; i < maxLevel; i++) {
    if (!cells[i]) break;
    path.push(cells[i]);
  }
  return path;
}

/** NameChildList → 批量创建文本（与 parseBatchTagText 对齐） */
export function nameChildListToBatchText(
  nodes: NameChildList[],
  maxLevel: 3 | 4,
  level = 1,
): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const name = node.name?.trim();
    if (!name) continue;
    const children = (node.nameChildList ?? []).filter((c) => c.name?.trim());
    if (level >= maxLevel) {
      lines.push(name);
      continue;
    }
    lines.push(`${"#".repeat(level)} ${name}`);
    if (level === maxLevel - 1) {
      for (const child of children) {
        const childName = child.name?.trim();
        if (childName) lines.push(childName);
      }
      continue;
    }
    if (children.length) {
      const nested = nameChildListToBatchText(children, maxLevel, level + 1);
      if (nested) lines.push(nested);
    }
  }
  return lines.join("\n");
}

export function flattenTagNodesToRows(tree: TagNode[], maxLevel: 3 | 4): string[][] {
  const rows: string[][] = [];
  const walk = (nodes: TagNode[], path: string[]) => {
    for (const node of nodes) {
      if (node.isDeleted || node.verb === "delete") continue;
      const next = [...path, node.name];
      const children = (node.children ?? []).filter((c) => !c.isDeleted && c.verb !== "delete");
      if (!children.length || next.length >= maxLevel) {
        const row = Array(maxLevel).fill("");
        next.slice(0, maxLevel).forEach((value, index) => {
          row[index] = value;
        });
        rows.push(row);
      } else {
        walk(children, next);
      }
    }
  };
  walk(tree, []);
  return rows;
}

/** 从二维表（含表头）解析为行对象 */
export function matrixToTagImportRows(matrix: string[][]): TagImportRow[] {
  const headerIndex = matrix.findIndex((row) =>
    row.some((cell) => HEADER_ALIASES[normalizeHeader(String(cell ?? ""))] !== undefined),
  );
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((cell) => String(cell ?? "").trim());
  const rows: TagImportRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const line = matrix[i];
    if (!line?.some((cell) => String(cell ?? "").trim())) continue;
    const record: TagImportRow = {};
    headers.forEach((header, j) => {
      if (!header) return;
      record[header] = String(line[j] ?? "").trim();
    });
    rows.push(record);
  }
  return rows;
}
