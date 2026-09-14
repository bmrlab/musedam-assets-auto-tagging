import "server-only";

import { AssetTagExtra } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { getStrongKeywordVariantsForTagName, normalizeForMatch, pathIncludesKeyword } from "./predict";

/**
 * 同一个（标签, 自动关键词）组合累计被人工拒绝达到这个次数后，
 * 自动把该关键词写入标签的 negativeKeywords，此后不再参与硬匹配 / LLM 关键词匹配。
 */
export const KEYWORD_REJECTION_AUTO_EXCLUDE_THRESHOLD = 3;

/**
 * 审核环节拒绝了某个 AI 推荐标签时调用：反推出触发这次推荐的自动拆词关键词
 * （复用 predict.ts 里硬匹配用的同一套拆词/边界匹配规则），累计该关键词的拒绝次数，
 * 达到阈值后自动写入标签的 negativeKeywords，形成"人工拒绝 -> 自动降权"的反馈闭环。
 *
 * 只处理"由文件名/路径关键词触发"的这一类误判（例如 POPUP 误判为 POP-UP视频）；
 * 纯内容语义类的拒绝（如画面识别不准）不在这个反馈机制的覆盖范围内。
 *
 * 失败是非致命的：调用方应把这当作尽力而为的旁路反馈，不应阻断审核主流程。
 */
export async function recordKeywordRejectionFeedback({
  teamId,
  leafTagId,
  materializedPath,
  assetName,
}: {
  teamId: number;
  leafTagId: number;
  materializedPath: string;
  assetName: string;
}): Promise<{ autoExcludedKeyword?: string }> {
  const tag = await prisma.assetTag.findUnique({
    where: { id: leafTagId },
    select: { id: true, teamId: true, name: true, extra: true },
  });
  if (!tag || tag.teamId !== teamId) return {};

  const extra = (tag.extra as AssetTagExtra) || {};
  const existingNegativeKeywords = extra.negativeKeywords ?? [];
  const negativeKeywordSet = new Set(existingNegativeKeywords.map((k) => normalizeForMatch(k)));

  const candidateKeywords = getStrongKeywordVariantsForTagName(tag.name).filter(
    (keyword) => !negativeKeywordSet.has(keyword),
  );
  if (candidateKeywords.length === 0) return {};

  const normalizedPath = normalizeForMatch(materializedPath);
  const normalizedName = normalizeForMatch(assetName);
  const matchedKeyword = candidateKeywords.find(
    (keyword) =>
      pathIncludesKeyword(normalizedPath, keyword) || pathIncludesKeyword(normalizedName, keyword),
  );
  // 这次拒绝跟自动拆词关键词无关（例如是内容语义类误判），不计入反馈统计
  if (!matchedKeyword) return {};

  const rejectionCounts = { ...(extra.keywordRejectionCounts ?? {}) };
  rejectionCounts[matchedKeyword] = (rejectionCounts[matchedKeyword] ?? 0) + 1;

  const shouldAutoExclude = rejectionCounts[matchedKeyword] >= KEYWORD_REJECTION_AUTO_EXCLUDE_THRESHOLD;
  const nextNegativeKeywords = shouldAutoExclude
    ? [...existingNegativeKeywords, matchedKeyword]
    : existingNegativeKeywords;

  await prisma.assetTag.update({
    where: { id: leafTagId },
    data: {
      extra: {
        ...extra,
        keywordRejectionCounts: rejectionCounts,
        negativeKeywords: nextNegativeKeywords,
      },
    },
  });

  return shouldAutoExclude ? { autoExcludedKeyword: matchedKeyword } : {};
}

/**
 * 客户在标签设置页手动编辑"排除关键词"时调用：把这次列表里被删掉的关键词，
 * 从 keywordRejectionCounts 累计计数里一并清掉。否则删除只是清空展示，
 * 底层计数器还停留在旧值，之后哪怕只被拒绝 1 次也会立刻重新触发自动拉黑，
 * 客户会觉得"删了跟没删一样"。
 */
export function pruneRejectionCountsForRemovedKeywords(
  extra: Pick<AssetTagExtra, "negativeKeywords" | "keywordRejectionCounts">,
  nextNegativeKeywords: string[],
): Pick<AssetTagExtra, "negativeKeywords" | "keywordRejectionCounts"> {
  const previousNegativeKeywords = (extra.negativeKeywords ?? []).map((keyword) =>
    normalizeForMatch(keyword),
  );
  const nextNormalizedSet = new Set(nextNegativeKeywords.map((keyword) => normalizeForMatch(keyword)));
  const removedKeywords = previousNegativeKeywords.filter(
    (keyword) => !nextNormalizedSet.has(keyword),
  );

  if (removedKeywords.length === 0 || !extra.keywordRejectionCounts) {
    return { negativeKeywords: nextNegativeKeywords, keywordRejectionCounts: extra.keywordRejectionCounts };
  }

  const keywordRejectionCounts = { ...extra.keywordRejectionCounts };
  for (const keyword of removedKeywords) {
    delete keywordRejectionCounts[keyword];
  }
  return { negativeKeywords: nextNegativeKeywords, keywordRejectionCounts };
}

/**
 * 批量处理一批（leafTagId, 拒绝原因所属素材）反馈，内部串行执行、单条失败不影响其他条目。
 */
export async function recordKeywordRejectionFeedbackBatch(
  items: Array<{
    teamId: number;
    leafTagId: number;
    materializedPath: string;
    assetName: string;
  }>,
): Promise<void> {
  for (const item of items) {
    try {
      await recordKeywordRejectionFeedback(item);
    } catch (error) {
      console.error("记录审核拒绝反馈失败:", error);
    }
  }
}
