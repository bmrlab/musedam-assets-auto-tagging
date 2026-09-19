import { AssetTagExtra, TagWithChildren } from "@/prisma/client";
import { TagWithScore } from "./types";

/**
 * 标签的"证据策略"：决定这个标签允许什么样的证据来支撑一次 AI 预测。
 * - content：描述画面/内容本身的标签（面霜、海报、户外场景），任何信息源的语义判断都可以贡献分数。
 * - literal：描述素材之外的业务安排的标签（投放渠道、目标市场、活动、档期），画面回答不了，
 *   必须有字面证据——文件名/路径/描述/关键词里真实出现，或视觉分析原文里明确写出了对应文字/标识。
 *
 * 策略存放在 AssetTag.extra.evidencePolicy，由系统自动判定（见 evidence-policy-server.ts），
 * 审核反馈也会把反复"仅凭内容分析就被打上又被人工拒绝"的标签自动降级为 literal。
 * 没有显式策略的标签回退到旧的分类名启发式（分类名含"渠道"），保证旧数据行为不变。
 */
export type EvidencePolicy = "content" | "literal";

/** 旧启发式：一级/二级分类名包含这些词的标签视为 literal。仅作为缺少显式策略时的兜底。 */
export const LEGACY_METADATA_CATEGORY_KEYWORDS = ["渠道"];

/** 同一标签"仅由 contentAnalysis 支持"却被人工拒绝达到该次数后，自动降级为 literal。 */
export const CONTENT_ONLY_REJECTION_AUTO_LITERAL_THRESHOLD = 3;

export function isLegacyMetadataCategoryTagPath(tagPath: string[]): boolean {
  // 只看一级/二级分类名，不看叶子标签自身名字（叶子名字通常是具体渠道名如"抖音"，
  // 本身不含"渠道"二字，需要靠上级分类名判断这是不是"渠道类"标签）。
  return tagPath
    .slice(0, Math.max(tagPath.length - 1, 1))
    .some((name) => LEGACY_METADATA_CATEGORY_KEYWORDS.some((keyword) => name.includes(keyword)));
}

export function getExplicitEvidencePolicy(extra: unknown): EvidencePolicy | undefined {
  const policy = (extra as AssetTagExtra | null)?.evidencePolicy;
  return policy === "content" || policy === "literal" ? policy : undefined;
}

/**
 * 解析某个标签生效的证据策略：显式策略优先，否则回退到分类名启发式。
 * @param tagPath 从一级到该标签自身的完整路径
 */
export function resolveEvidencePolicy(extra: unknown, tagPath: string[]): EvidencePolicy {
  return (
    getExplicitEvidencePolicy(extra) ??
    (isLegacyMetadataCategoryTagPath(tagPath) ? "literal" : "content")
  );
}

export type TagTreeNodeWithPath = {
  id: number;
  name: string;
  extra: unknown;
  tagPath: string[];
  depth: 1 | 2 | 3;
  /** 直接父节点 id，一级节点为 undefined */
  parentId?: number;
  hasChildren: boolean;
};

/** 把三层标签树拍平成带完整路径的节点列表（一级/二级/三级都包含，因为模型可以匹配任意层级）。 */
export function flattenTagsTree(tagsTree: TagWithChildren[]): TagTreeNodeWithPath[] {
  const nodes: TagTreeNodeWithPath[] = [];
  for (const lv1 of tagsTree) {
    nodes.push({
      id: lv1.id,
      name: lv1.name,
      extra: lv1.extra,
      tagPath: [lv1.name],
      depth: 1,
      hasChildren: (lv1.children ?? []).length > 0,
    });
    for (const lv2 of lv1.children ?? []) {
      nodes.push({
        id: lv2.id,
        name: lv2.name,
        extra: lv2.extra,
        tagPath: [lv1.name, lv2.name],
        depth: 2,
        parentId: lv1.id,
        hasChildren: (lv2.children ?? []).length > 0,
      });
      for (const lv3 of lv2.children ?? []) {
        nodes.push({
          id: lv3.id,
          name: lv3.name,
          extra: lv3.extra,
          tagPath: [lv1.name, lv2.name, lv3.name],
          depth: 3,
          parentId: lv2.id,
          hasChildren: false,
        });
      }
    }
  }
  return nodes;
}

export function getExplicitSiblingsExclusive(extra: unknown): boolean | undefined {
  const value = (extra as AssetTagExtra | null)?.siblingsExclusive;
  return typeof value === "boolean" ? value : undefined;
}

export function getExplicitRequiredGroup(extra: unknown): boolean | undefined {
  const value = (extra as AssetTagExtra | null)?.requiredGroup;
  return typeof value === "boolean" ? value : undefined;
}

export type ExclusiveBranch = { parentId: number; branchId: number };

/**
 * 同级互斥的分支归属解析器：给定任意标签 id，沿祖先链向上，每遇到一个互斥父分类，
 * 就以"该父分类的直接子节点"为分支参与一次竞争（三级标签代表它所在的二级分支）。
 * predict.ts（AI 各来源之间）与 exclusive-siblings.ts（AI vs 特征库）共用同一套归属规则。
 */
export function buildExclusiveBranchResolver(tagsTree: TagWithChildren[]): {
  exclusiveParentIds: ReadonlySet<number>;
  parentById: ReadonlyMap<number, number>;
  branchesOf: (tagId: number) => ExclusiveBranch[];
} {
  const parentById = new Map<number, number>();
  const exclusiveParentIds = new Set<number>();
  for (const node of flattenTagsTree(tagsTree)) {
    if (node.parentId !== undefined) parentById.set(node.id, node.parentId);
    if (node.hasChildren && getExplicitSiblingsExclusive(node.extra) === true) {
      exclusiveParentIds.add(node.id);
    }
  }
  const branchesOf = (tagId: number): ExclusiveBranch[] => {
    const branches: ExclusiveBranch[] = [];
    let nodeId = tagId;
    for (;;) {
      const parentId = parentById.get(nodeId);
      if (parentId === undefined) break;
      if (exclusiveParentIds.has(parentId)) branches.push({ parentId, branchId: nodeId });
      nodeId = parentId;
    }
    return branches;
  };
  return { exclusiveParentIds, parentById, branchesOf };
}

/** 树中缺少显式证据策略、或（有子标签但）缺少同级互斥判定的节点，供自动判定使用。 */
export function collectTagsMissingEvidencePolicy(
  tagsTree: TagWithChildren[],
): TagTreeNodeWithPath[] {
  return flattenTagsTree(tagsTree).filter(
    (node) =>
      getExplicitEvidencePolicy(node.extra) === undefined ||
      (node.hasChildren && getExplicitSiblingsExclusive(node.extra) === undefined),
  );
}

export type TagClassification = { policy: EvidencePolicy; siblingsExclusive?: boolean };

/** 把判定结果写回内存中的标签树（不落库），让本次预测立刻生效。 */
export function applyEvidencePoliciesToTree(
  tagsTree: TagWithChildren[],
  classificationById: ReadonlyMap<number, EvidencePolicy | TagClassification>,
  source: NonNullable<AssetTagExtra["evidencePolicySource"]> = "auto",
): void {
  const visit = (tag: TagWithChildren) => {
    const raw = classificationById.get(tag.id);
    if (raw) {
      const classification: TagClassification = typeof raw === "string" ? { policy: raw } : raw;
      const extra = ((tag.extra as AssetTagExtra | null) ?? {}) as AssetTagExtra;
      tag.extra = {
        ...extra,
        evidencePolicy: classification.policy,
        evidencePolicySource: source,
        ...(classification.siblingsExclusive !== undefined
          ? { siblingsExclusive: classification.siblingsExclusive }
          : {}),
      };
    }
    for (const child of tag.children ?? []) visit(child);
  };
  for (const tag of tagsTree) visit(tag);
}

/**
 * 一条被拒绝的 AI 推荐，是否"只有内容分析来源在支撑"。
 * 这类拒绝说明模型仅凭画面印象就打上了标签，是把该标签降级为 literal 的信号；
 * 有文件名/路径/关键词来源支撑的拒绝不算（那是别的问题，走关键词负反馈）。
 */
export function isContentOnlySupport(
  confidenceBySources: TagWithScore["confidenceBySources"] | undefined,
): boolean {
  if (!confidenceBySources) return false;
  const sources = Object.entries(confidenceBySources)
    .filter(([, confidence]) => typeof confidence === "number")
    .map(([source]) => source);
  return sources.length === 1 && sources[0] === "contentAnalysis";
}

/**
 * 累计一次"仅凭内容分析被拒绝"，返回新的 extra；达到阈值时把策略切到 literal。
 * 已经是显式 literal 的标签不再计数。
 */
export function applyContentOnlyRejection(extra: AssetTagExtra | null | undefined): {
  extra: AssetTagExtra;
  downgraded: boolean;
} {
  const current = extra ?? {};
  if (getExplicitEvidencePolicy(current) === "literal") {
    return { extra: current, downgraded: false };
  }
  const count = (current.contentOnlyRejectionCount ?? 0) + 1;
  if (count >= CONTENT_ONLY_REJECTION_AUTO_LITERAL_THRESHOLD) {
    return {
      extra: {
        ...current,
        contentOnlyRejectionCount: count,
        evidencePolicy: "literal",
        evidencePolicySource: "feedback",
      },
      downgraded: true,
    };
  }
  return { extra: { ...current, contentOnlyRejectionCount: count }, downgraded: false };
}
