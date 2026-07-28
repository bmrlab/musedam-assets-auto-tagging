import type { TaggingFaceFeatures, TagWithChildren } from "@/prisma/client";

const PEOPLE_COUNT_PARENT_RE = /people\s*count|人数|人物数量|人员数量/i;

export function isPeopleCountTagPath(tagPath: string[]): boolean {
  return tagPath.some((segment) => PEOPLE_COUNT_PARENT_RE.test(segment.trim()));
}

/** Collect People Count leaf paths from the tag tree for LLM selection. */
export function collectPeopleCountTagPaths(tagsTree: TagWithChildren[]): string[][] {
  const paths: string[][] = [];

  const walk = (nodes: TagWithChildren[], path: string[]) => {
    for (const node of nodes) {
      const nextPath = [...path, node.name];
      const children = node.children ?? [];
      if (children.length === 0) {
        if (isPeopleCountTagPath(nextPath)) {
          paths.push(nextPath);
        }
        continue;
      }
      walk(children, nextPath);
    }
  };

  walk(tagsTree, []);
  return paths;
}

export function buildFaceFeaturesPromptSection(
  faceFeatures: TaggingFaceFeatures | undefined,
  peopleCountTagPaths: string[][] = [],
): string {
  if (!faceFeatures) {
    return "";
  }

  const peopleCountOptions =
    peopleCountTagPaths.length > 0
      ? peopleCountTagPaths.map((path) => `- ${path.join(" > ")}`).join("\n")
      : "- （标签体系中未找到 People Count / 人数 类叶子标签）";

  return `

## faceFeatures辅助信号（特征识别）
人物数量：${faceFeatures.faceCount}（当前暂以 faceCount 作为人物总数）
是否检测到人脸：${faceFeatures.found ? "是" : "否"}

### 可用人数类标签（请由你判断哪个与 faceCount 匹配）
${peopleCountOptions}

判断要求：
1. 当前将 faceCount 视为准确的人物总数；人数/People Count 相关标签必须严格以该数值为准，选择包含该人数的一档（或都不选）。
2. 禁止选择与 faceCount 明显冲突的人数标签（例如 faceCount=3 时不要选 5+ / 5人以上）。
3. 若没有合适档位，可跳过人数类标签，不要为了凑标签而硬选。
4. faceFeatures 不是独立输出 source，只作为辅助证据。`;
}
