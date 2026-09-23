import { isAcceptedPersonFace } from "@/lib/person/person-match-policy";
import { getAcceptedProductMatches } from "@/lib/product/product-match-policy";
import { normalizeFeatureConfidence } from "@/lib/tagging/feature-confidence";
import type {
  TaggingBrandRecommendation,
  TaggingIpRecommendation,
  TaggingPersonRecommendation,
  TaggingProductRecommendation,
  TagWithChildren,
} from "@/prisma/client";
import { getBrandRecommendationTagIdsFromQueueResult } from "./brand-recommendation";
import { buildExclusiveBranchResolver } from "./evidence-policy";
import { getIpRecommendationTagIdsFromQueueResult } from "./ip-recommendation";
import type { TagWithScore } from "./types";

/** 特征库（品牌/IP/商品/人物）匹配出来的一条标签候选，confidence 为 0-100 */
export type FeatureTagCandidate = {
  leafTagId: number;
  confidence: number;
  featureType: "brand" | "ip" | "product" | "person";
};

const TEXTUAL_SOURCES = new Set(["basicInfo", "materializedPath", "tagKeywords"]);

/** AI 标签是否"仅凭内容推测"：没有任何文件名/路径/关键词等文本来源支撑。 */
export function isContentInferredOnly(tag: TagWithScore): boolean {
  const sources = Object.entries(tag.confidenceBySources)
    .filter(([, confidence]) => typeof confidence === "number")
    .map(([source]) => source);
  return sources.length > 0 && !sources.some((source) => TEXTUAL_SOURCES.has(source));
}

/**
 * 从队列结果里收集已过各自置信度门槛的特征库标签候选（口径与直接写回/审核采纳一致）。
 * 品牌/IP 共用 bestMatch.confidence；商品按每个已采纳商品、人物按每张被采纳人脸的置信度。
 */
export function collectFeatureTagCandidates({
  brandRecommendation,
  ipRecommendation,
  productRecommendation,
  personRecommendation,
}: {
  brandRecommendation?: TaggingBrandRecommendation | null;
  ipRecommendation?: TaggingIpRecommendation | null;
  productRecommendation?: TaggingProductRecommendation | null;
  personRecommendation?: TaggingPersonRecommendation | null;
}): FeatureTagCandidate[] {
  const candidates: FeatureTagCandidate[] = [];
  const push = (
    featureType: FeatureTagCandidate["featureType"],
    leafTagIds: number[],
    confidence: number | null | undefined,
  ) => {
    const normalized = normalizeFeatureConfidence(confidence);
    for (const leafTagId of leafTagIds)
      candidates.push({ leafTagId, confidence: normalized, featureType });
  };

  push(
    "brand",
    getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation }),
    brandRecommendation?.bestMatch?.confidence,
  );
  push(
    "ip",
    getIpRecommendationTagIdsFromQueueResult({ ipRecommendation }),
    ipRecommendation?.bestMatch?.confidence,
  );
  for (const match of getAcceptedProductMatches(productRecommendation)) {
    push(
      "product",
      (match.recommendedTags ?? [])
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
      match.confidence,
    );
  }
  for (const face of personRecommendation?.faces ?? []) {
    if (!isAcceptedPersonFace(face) || !face.bestMatch) continue;
    push(
      "person",
      (face.bestMatch.recommendedTags ?? [])
        .map((tag) => tag.assetTagId)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
      face.bestMatch.confidence,
    );
  }
  return candidates;
}

export type CrossSourceExclusiveDrop = {
  leafTagId: number;
  tagPath: string[];
  parentId: number;
  winnerLeafTagId: number;
  reason: "feature-over-inferred" | "feature-higher-score";
};

/**
 * 同级互斥硬约束（AI 预测 vs 特征库）：resolveExclusiveSiblings 只在 AI 各来源之间取舍，
 * 特征库匹配出来的标签此前完全不参与互斥，导致"特征库认出 A、AI 猜了同组的 B"时两条都写进素材。
 * 规则（按用户确认）：
 * - 同一互斥父分类下，特征库命中了分支 A，AI 标签落在分支 B：
 *   - AI 标签仅凭内容推测（无文本来源）→ 删 AI 标签，特征库胜；
 *   - AI 标签有文本来源（文件名/路径/关键词强匹配）→ 比分，特征库 confidence（0-100）更高时才删 AI 标签。
 * - 特征库标签本身不删（由各自置信度门槛把关）；同一分支内的 AI 标签不受影响。
 * 只作用于本次 AI 打标输出，不考虑素材上已有的标签。
 */
export function resolveExclusiveSiblingsAcrossSources({
  tagsTree,
  tagsWithScore,
  featureCandidates,
}: {
  tagsTree: TagWithChildren[];
  tagsWithScore: TagWithScore[];
  featureCandidates: FeatureTagCandidate[];
}): { tagsWithScore: TagWithScore[]; dropped: CrossSourceExclusiveDrop[] } {
  if (featureCandidates.length === 0 || tagsWithScore.length === 0) {
    return { tagsWithScore, dropped: [] };
  }
  const { exclusiveParentIds, branchesOf } = buildExclusiveBranchResolver(tagsTree);
  if (exclusiveParentIds.size === 0) return { tagsWithScore, dropped: [] };

  // 每个互斥父分类下，特征库占据的分支及其最高置信度
  type FeatureBranch = { branchId: number; confidence: number; leafTagId: number };
  const featureBranchByParent = new Map<number, FeatureBranch>();
  const productBranchesByParent = new Map<number, Set<number>>();
  for (const candidate of featureCandidates) {
    for (const { parentId, branchId } of branchesOf(candidate.leafTagId)) {
      // 一张图中可以识别出多个商品；每个已采纳商品所在的分支都受保护。
      if (candidate.featureType === "product") {
        const branches = productBranchesByParent.get(parentId) ?? new Set<number>();
        branches.add(branchId);
        productBranchesByParent.set(parentId, branches);
      }
      const current = featureBranchByParent.get(parentId);
      if (!current || candidate.confidence > current.confidence) {
        featureBranchByParent.set(parentId, {
          branchId,
          confidence: candidate.confidence,
          leafTagId: candidate.leafTagId,
        });
      }
    }
  }
  if (featureBranchByParent.size === 0) return { tagsWithScore, dropped: [] };

  const dropped: CrossSourceExclusiveDrop[] = [];
  const kept = tagsWithScore.filter((tag) => {
    // 确定性来源（画幅比例等）不参与与特征库的竞争
    if (tag.origin === "aspectRatio") return true;
    for (const { parentId, branchId } of branchesOf(tag.leafTagId)) {
      if (productBranchesByParent.get(parentId)?.has(branchId)) continue;
      const feature = featureBranchByParent.get(parentId);
      if (!feature || feature.branchId === branchId) continue;
      const inferredOnly = isContentInferredOnly(tag);
      if (inferredOnly || feature.confidence > tag.score) {
        dropped.push({
          leafTagId: tag.leafTagId,
          tagPath: tag.tagPath,
          parentId,
          winnerLeafTagId: feature.leafTagId,
          reason: inferredOnly ? "feature-over-inferred" : "feature-higher-score",
        });
        return false;
      }
    }
    return true;
  });
  return { tagsWithScore: kept, dropped };
}
