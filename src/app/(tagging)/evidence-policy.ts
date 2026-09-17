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
};

/** 把三层标签树拍平成带完整路径的节点列表（一级/二级/三级都包含，因为模型可以匹配任意层级）。 */
export function flattenTagsTree(tagsTree: TagWithChildren[]): TagTreeNodeWithPath[] {
  const nodes: TagTreeNodeWithPath[] = [];
  for (const lv1 of tagsTree) {
    nodes.push({ id: lv1.id, name: lv1.name, extra: lv1.extra, tagPath: [lv1.name], depth: 1 });
    for (const lv2 of lv1.children ?? []) {
      nodes.push({
        id: lv2.id,
        name: lv2.name,
        extra: lv2.extra,
        tagPath: [lv1.name, lv2.name],
        depth: 2,
      });
      for (const lv3 of lv2.children ?? []) {
        nodes.push({
          id: lv3.id,
          name: lv3.name,
          extra: lv3.extra,
          tagPath: [lv1.name, lv2.name, lv3.name],
          depth: 3,
        });
      }
    }
  }
  return nodes;
}

/** 树中缺少显式证据策略的节点，供自动判定使用。 */
export function collectTagsMissingEvidencePolicy(tagsTree: TagWithChildren[]): TagTreeNodeWithPath[] {
  return flattenTagsTree(tagsTree).filter((node) => getExplicitEvidencePolicy(node.extra) === undefined);
}

/** 把判定结果写回内存中的标签树（不落库），让本次预测立刻生效。 */
export function applyEvidencePoliciesToTree(
  tagsTree: TagWithChildren[],
  policyById: ReadonlyMap<number, EvidencePolicy>,
  source: NonNullable<AssetTagExtra["evidencePolicySource"]> = "auto",
): void {
  const visit = (tag: TagWithChildren) => {
    const policy = policyById.get(tag.id);
    if (policy) {
      const extra = ((tag.extra as AssetTagExtra | null) ?? {}) as AssetTagExtra;
      tag.extra = { ...extra, evidencePolicy: policy, evidencePolicySource: source };
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
