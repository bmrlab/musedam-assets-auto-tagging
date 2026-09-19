import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import {
  AssetObject,
  AssetObjectContentAnalysis,
  AssetObjectExtra,
  AssetTagExtra,
  TaggingFaceFeatures,
  TaggingQueueItemExtra,
  TagWithChildren,
} from "@/prisma/client";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { generateObject, UserModelMessage } from "ai";
import { createHash } from "node:crypto";
import z from "zod";
import { collectAspectRatioTagIds, detectAspectRatioGroups } from "./aspect-ratio";
import {
  buildExclusiveBranchResolver,
  flattenTagsTree,
  getExplicitRequiredGroup,
  resolveEvidencePolicy,
} from "./evidence-policy";
import { fetchTagsTreeForTagging } from "./evidence-policy-server";
import { buildFaceFeaturesPromptSection, collectPeopleCountTagPaths } from "./face-features";
import {
  RECOGNITION_ACCURACY_CONFIG,
  RecognitionAccuracyMode,
  tagPredictionSystemPrompt,
} from "./prompt";
import { SourceBasedTagPredictions, tagPredictionSchema, TagWithScore } from "./types";
import { buildTagKeywordsText, buildTagStructureText } from "./utils";

function taggingPredictError(code: string, message: string) {
  const err = new Error(message);
  (err as unknown as { code?: string }).code = code;
  return err;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getTaggingPredictModel(): LLMModelName {
  return (process.env.TAGGING_PREDICT_MODEL?.trim() || "gpt-5-mini") as LLMModelName;
}

function getTaggingPredictProviderOptions(modelName: LLMModelName, teamId: string | number) {
  if (!modelName.startsWith("gpt-5")) return undefined;

  return {
    // azure openai provider 这里也是 openai
    openai: {
      promptCacheKey: `musedam-t-${teamId}`,
      reasoningSummary: "auto", // 'auto' | 'detailed'
      reasoningEffort: "minimal", // 'minimal' | 'low' | 'medium' | 'high'
    } satisfies OpenAIResponsesProviderOptions,
  };
}

const REPAIR_LOG_TEXT_PREVIEW_LENGTH = 500;

function logRepairFailure(stage: string, text: string, context?: { attempt?: number }) {
  // 修复失败时不能静默返回空结果：那会让整个预测走完 3 次重试后以 NO_VALID_TAGS 失败，
  // 从日志里完全看不出模型到底返回了什么。这里至少留下原文片段与失败阶段。
  console.warn("AI标签预测 JSON 修复失败", {
    stage,
    attempt: context?.attempt,
    textLength: text.length,
    textPreview: text.slice(0, REPAIR_LOG_TEXT_PREVIEW_LENGTH),
  });
}

export function repairToPredictionEnvelopeText(
  text: string,
  context?: { attempt?: number },
): string {
  const cleaned = (text ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // 尝试直接解析
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return JSON.stringify({ predictions: parsed });
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { predictions?: unknown }).predictions)
    ) {
      return cleaned;
    }
    logRepairFailure("direct-parse-unexpected-shape", cleaned, context);
    return '{"predictions":[]}';
  } catch {}

  // 截取 [] 范围
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) {
    logRepairFailure("no-bracket", cleaned, context);
    return '{"predictions":[]}';
  }

  let candidate = cleaned.slice(start, end + 1);

  // 兜底：修复常见的 JSON 语法错误
  candidate = candidate
    .replace(/,\s*]/g, "]") // 移除末尾多余的逗号
    .replace(/([{,])\s*(\w+):/g, '$1"$2":') // 补全属性名的引号
    .replace(/:\s*([^"[\d{,}]+?)([,}])/g, ':"$1"$2'); // 给字符串值补全引号

  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return JSON.stringify({ predictions: parsed });
    }
    logRepairFailure("repaired-parse-not-array", cleaned, context);
    return '{"predictions":[]}';
  } catch {
    logRepairFailure("repaired-parse", cleaned, context);
    return '{"predictions":[]}';
  }
}

const tagPredictionsResponseSchema = z.object({
  predictions: z.array(tagPredictionSchema),
});

// export const WeightOfSource: Record<z.Infer<typeof tagPredictionSchema.shape.source>, number> = {
//   basicInfo: 35,
//   materializedPath: 30,
//   contentAnalysis: 25,
//   tagKeywords: 10,
// };

// 多源标签分数计算权重配置
const SCORING_WEIGHTS: Record<z.Infer<typeof tagPredictionSchema.shape.source>, number> = {
  basicInfo: 0.7,
  materializedPath: 0.6,
  contentAnalysis: 0.85,
  tagKeywords: 0.95,
};

// 硬匹配（关键词字面命中）统一使用的置信度和单次最多注入的标签数量上限，
// materializedPath（文件夹路径）和 basicInfo（文件名/描述）两个文本类来源共用。
const TEXT_HARD_MATCH_CONFIDENCE = 0.9;
const TEXT_HARD_MATCH_MAX_ENHANCED_TAGS = 12;

export function normalizeForMatch(text: string): string {
  return (text ?? "").toLowerCase().trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 纯字母数字关键词要求命中位置左右都不是字母数字，避免 "pop" 这类短关键词
 * 命中 "popup" 这种子串（曾导致图片素材因文件名含 "POPUP" 被误判为 "POP-UP视频"）。
 * 中日韩等非纯 ASCII 关键词没有天然词边界，维持原有子串匹配。
 */
export function pathIncludesKeyword(normalizedPath: string, keyword: string): boolean {
  if (/^[a-z0-9]+$/i.test(keyword)) {
    const boundaryRegex = new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i");
    return boundaryRegex.test(normalizedPath);
  }
  return normalizedPath.includes(keyword);
}

/** 引用式校验：模型摘录的 evidence 至少要有这么长，避免用"的""图"这类单字蒙混过关。 */
const MIN_EVIDENCE_QUOTE_LENGTH = 2;
/** 纯 ASCII 的引用片段视为"别名/缩写"（xhs、tmall、1111、dy_feed），超过这个长度就不像缩写了。 */
const MAX_ASCII_ALIAS_QUOTE_LENGTH = 12;
const CJK_CHAR_REGEX = /[\u3400-\u9fff]/;

function hasCommonSubstring(a: string, b: string, minLength: number): boolean {
  if (a.length < minLength || b.length < minLength) return false;
  for (let i = 0; i + minLength <= a.length; i++) {
    if (b.includes(a.slice(i, i + minLength))) return true;
  }
  return false;
}

/**
 * 引用片段是否"看起来确实在指代这个标签"。只验证"片段在原文里"是不够的：
 * 模型可以把原文里任意一句（如"清新风格"）当作"小红书"的证据蒙混过关。
 * - 纯 ASCII 短片段：视为别名/缩写（xhs → 小红书），信任模型的归一；
 * - 含中日韩字符的片段：必须与标签名或配置关键词有至少 2 个连续字符重叠（"红书"→"小红书"）。
 * - allowHeadCharOverlap：内容型品类标签允许"中心语"重叠——中文品类词的中心语在末尾
 *   （修护霜 / 面霜、洁面乳 / 乳液），片段里出现标签名末字也算指代。字面型标签（渠道/活动等）
 *   不开这个口子，"读书会"不能当"小红书"的证据。
 */
export function isPlausibleEvidenceQuoteForTag(
  quote: string | undefined,
  tagNameAndKeywords: readonly string[],
  options?: { allowHeadCharOverlap?: boolean },
): boolean {
  const normalizedQuote = normalizeForMatch(quote ?? "");
  if (normalizedQuote.length < MIN_EVIDENCE_QUOTE_LENGTH) return false;
  if (!CJK_CHAR_REGEX.test(normalizedQuote)) {
    return normalizedQuote.length <= MAX_ASCII_ALIAS_QUOTE_LENGTH && !/\s/.test(normalizedQuote);
  }
  return tagNameAndKeywords.some((candidate) => {
    const normalizedCandidate = normalizeForMatch(candidate);
    if (hasCommonSubstring(normalizedQuote, normalizedCandidate, 2)) return true;
    if (!options?.allowHeadCharOverlap) return false;
    const headChar = normalizedCandidate.slice(-1);
    return CJK_CHAR_REGEX.test(headChar) && normalizedQuote.includes(headChar);
  });
}

function evidenceQuoteAppearsIn(evidenceText: string, quote: string | undefined): boolean {
  const normalizedQuote = normalizeForMatch(quote ?? "");
  if (normalizedQuote.length < MIN_EVIDENCE_QUOTE_LENGTH) return false;
  return evidenceText.includes(normalizedQuote);
}

/**
 * 字面型标签（证据策略 literal，见 evidence-policy.ts：渠道/市场/活动/档期等"素材之外的安排"）
 * 在任何来源下都必须有字面证据支撑，否则丢弃该来源对该标签的贡献。字面证据二选一即可：
 * 1) 标签名自动拆词得到的强关键词，或标签手动配置的 matching keywords，实际出现在该来源的证据文本里；
 * 2) 模型为这条预测摘录的 evidence 片段，原样出现在该来源的证据文本里，且看起来确实在指代这个标签
 *    （见 isPlausibleEvidenceQuoteForTag；别名归一交给模型，真伪校验交给代码，例如文件名写 xhs、
 *    模型摘录 "xhs" 并映射到"小红书"）。
 * 证据文本按来源给：contentAnalysis 看视觉分析原文（画面上明确可见的平台界面/水印/活动文字会写在里面），
 * tagKeywords / basicInfo 看文件名+描述(+路径)，materializedPath 看路径。没传证据文本的来源不做校验。
 * 内容型标签不受此规则约束。
 */
export function enforceLiteralEvidenceForMetadataTags(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
  evidenceTextBySource: Partial<Record<z.infer<typeof tagPredictionSchema.shape.source>, string>>,
): SourceBasedTagPredictions {
  const literalInfoById = new Map<
    number,
    { tagPath: string[]; keywords: string[]; nameAndKeywords: string[] }
  >();
  for (const node of flattenTagsTree(tagsTree)) {
    if (resolveEvidencePolicy(node.extra, node.tagPath) !== "literal") continue;
    const configuredKeywords = ((node.extra as AssetTagExtra)?.keywords ?? []).map(
      normalizeForMatch,
    );
    literalInfoById.set(node.id, {
      tagPath: node.tagPath,
      keywords: Array.from(
        new Set([...getStrongKeywordVariantsForTagName(node.name), ...configuredKeywords]),
      ).filter(Boolean),
      nameAndKeywords: [node.name, ...configuredKeywords],
    });
  }
  if (literalInfoById.size === 0) return predictions;

  return predictions.map((prediction) => {
    const evidenceText = evidenceTextBySource[prediction.source];
    if (evidenceText === undefined) return prediction;
    return {
      ...prediction,
      tags: prediction.tags.filter((tag) => {
        const info = literalInfoById.get(tag.leafTagId);
        if (!info) return true; // 内容型标签，不受此规则约束
        if (!evidenceText) return false; // 字面型标签但该来源没有任何证据文本，直接丢弃
        return (
          info.keywords.some((keyword) => pathIncludesKeyword(evidenceText, keyword)) ||
          (evidenceQuoteAppearsIn(evidenceText, tag.evidence) &&
            isPlausibleEvidenceQuoteForTag(tag.evidence, info.nameAndKeywords))
        );
      }),
    };
  });
}

/** 文本类来源：其证据文本本身就是一段文字，模型归到这些来源下的预测必须能在文字里找到依据。 */
const TEXTUAL_SOURCES = ["basicInfo", "materializedPath", "tagKeywords"] as const;
type TextualSource = (typeof TEXTUAL_SOURCES)[number];

function isTextualSource(source: string): source is TextualSource {
  return (TEXTUAL_SOURCES as readonly string[]).includes(source);
}

/**
 * 文本类来源（basicInfo / materializedPath / tagKeywords）的每条预测，不论标签类型，都必须有文字依据：
 * 标签名拆词或配置关键词出现在该来源文本里，或模型摘录的 evidence 原样出现在该来源文本里、
 * 且看起来确实在指代这个标签（见 isPlausibleEvidenceQuoteForTag，内容型标签放宽到中心语重叠）。
 * 否则丢弃该来源对该标签的贡献。这是为了堵住"模型顺手把一个标签标到多个来源"的问题：
 * 路径里根本没有"洁面"，模型却给洁面加了 materializedPath 来源，多源融合就把它抬到了面霜之上。
 * 没传证据文本的来源不做校验。
 */
export function enforceTextualSourceEvidence(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
  evidenceTextBySource: Partial<Record<TextualSource, string>>,
): SourceBasedTagPredictions {
  const infoById = new Map<number, { keywords: string[]; nameAndKeywords: string[] }>();
  for (const node of flattenTagsTree(tagsTree)) {
    const configuredKeywords = ((node.extra as AssetTagExtra)?.keywords ?? []).map(
      normalizeForMatch,
    );
    infoById.set(node.id, {
      keywords: Array.from(
        new Set([...getStrongKeywordVariantsForTagName(node.name), ...configuredKeywords]),
      ).filter(Boolean),
      nameAndKeywords: [node.name, ...configuredKeywords],
    });
  }

  return predictions.map((prediction) => {
    if (!isTextualSource(prediction.source)) return prediction;
    const evidenceText = evidenceTextBySource[prediction.source];
    if (evidenceText === undefined) return prediction;
    return {
      ...prediction,
      tags: prediction.tags.filter((tag) => {
        if (!evidenceText) return false;
        const info = infoById.get(tag.leafTagId);
        const keywords = info?.keywords ?? [];
        if (keywords.some((keyword) => pathIncludesKeyword(evidenceText, keyword))) return true;
        // 摘录的片段不仅要真的在原文里，还得看起来在指代这个标签：
        // 文件名"红茶水乳"整段被当成"底妆"/"功效教育"的证据，就是这里以前没拦住的。
        return (
          evidenceQuoteAppearsIn(evidenceText, tag.evidence) &&
          isPlausibleEvidenceQuoteForTag(tag.evidence, info?.nameAndKeywords ?? [], {
            allowHeadCharOverlap: true,
          })
        );
      }),
    };
  });
}

/**
 * 同级互斥硬约束：父分类 extra.siblingsExclusive 为 true 的组里，一个素材只能归属其中一个子标签。
 * 互斥沿祖先链传播：预测的是三级标签时，它同样代表了自己所在的二级分支——"产品品类"标了互斥，
 * 那么"护肤 > 面霜"和"彩妆 > 底妆"就是在争同一个位置，按各自分支整体取舍。
 * 分支排序（前者优先）：
 * 1. 锚定（有 basicInfo / materializedPath / tagKeywords 文本来源，已经过 enforceTextualSourceEvidence 校验）；
 * 2. 各来源最高置信度；
 * 3. 支撑来源数；
 * 4. branchId 小者（保证确定性）。
 * 落选分支下的标签从所有来源里**删除**（之前只是压到 0.45，宽泛模式下仍会通过门槛，
 * 客户案例里文件名同时锚定了两个品牌产品线导致两条都写进了素材）。
 * 不在互斥组的标签（父分类未标记或标记为 false）不受影响。
 */
export function resolveExclusiveSiblings(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
): SourceBasedTagPredictions {
  const { exclusiveParentIds, branchesOf } = buildExclusiveBranchResolver(tagsTree);
  if (exclusiveParentIds.size === 0) return predictions;

  type BranchStat = {
    anchored: boolean;
    best: number;
    sources: Set<string>;
    leafTagIds: Set<number>;
  };
  const byParent = new Map<number, Map<number, BranchStat>>();
  for (const prediction of predictions) {
    for (const tag of prediction.tags) {
      for (const { parentId, branchId } of branchesOf(tag.leafTagId)) {
        const branches = byParent.get(parentId) ?? new Map<number, BranchStat>();
        const stat = branches.get(branchId) ?? {
          anchored: false,
          best: 0,
          sources: new Set(),
          leafTagIds: new Set(),
        };
        stat.anchored = stat.anchored || isTextualSource(prediction.source);
        stat.best = Math.max(stat.best, tag.confidence);
        stat.sources.add(prediction.source);
        stat.leafTagIds.add(tag.leafTagId);
        branches.set(branchId, stat);
        byParent.set(parentId, branches);
      }
    }
  }

  const losers = new Set<number>();
  for (const [, branches] of byParent) {
    if (branches.size <= 1) continue;
    const [winner] = [...branches.entries()].sort(
      (a, b) =>
        Number(b[1].anchored) - Number(a[1].anchored) ||
        b[1].best - a[1].best ||
        b[1].sources.size - a[1].sources.size ||
        a[0] - b[0],
    );
    for (const [branchId, stat] of branches) {
      if (branchId === winner[0]) continue;
      for (const leafTagId of stat.leafTagIds) losers.add(leafTagId);
    }
  }
  if (losers.size === 0) return predictions;

  return predictions.map((prediction) => ({
    ...prediction,
    tags: prediction.tags.filter((tag) => !losers.has(tag.leafTagId)),
  }));
}

/**
 * 校验模型返回的 leafTagId 确实存在于本团队标签树（一级/二级/三级 id 都合法，prompt 允许匹配任意层级）。
 * - id 不存在：按 tagPath 逐层名字反查一次，命中则纠正 id，否则丢弃；
 * - id 存在但 tagPath 与真实路径不一致：以 id 为准，用真实路径覆盖（prompt 已声明"以 ID 纠错"）。
 * 之前没有这一步，模型幻觉出来的 id 会一路写进审核项，直到写回 MuseDAM 查不到 slug 时才被静默丢掉。
 */
export function filterPredictionsByKnownTagIds(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
): {
  predictions: SourceBasedTagPredictions;
  dropped: Array<{ source: string; leafTagId: number; tagPath: string[] }>;
  corrected: Array<{ source: string; fromLeafTagId: number; toLeafTagId: number }>;
} {
  const pathById = new Map<number, string[]>();
  const idByNormalizedPath = new Map<string, number>();
  const pathKey = (path: string[]) => path.map(normalizeForMatch).join("\u0000");
  const register = (id: number, path: string[]) => {
    pathById.set(id, path);
    idByNormalizedPath.set(pathKey(path), id);
  };
  for (const lv1 of tagsTree) {
    register(lv1.id, [lv1.name]);
    for (const lv2 of lv1.children ?? []) {
      register(lv2.id, [lv1.name, lv2.name]);
      for (const lv3 of lv2.children ?? []) {
        register(lv3.id, [lv1.name, lv2.name, lv3.name]);
      }
    }
  }

  const dropped: Array<{ source: string; leafTagId: number; tagPath: string[] }> = [];
  const corrected: Array<{ source: string; fromLeafTagId: number; toLeafTagId: number }> = [];

  const next = predictions.map((prediction) => ({
    ...prediction,
    tags: prediction.tags.flatMap((tag) => {
      const realPath = pathById.get(tag.leafTagId);
      if (realPath) {
        // id 合法：tagPath 以真实路径为准
        return [{ ...tag, tagPath: realPath }];
      }
      const recoveredId = idByNormalizedPath.get(pathKey(tag.tagPath));
      if (recoveredId !== undefined) {
        corrected.push({
          source: prediction.source,
          fromLeafTagId: tag.leafTagId,
          toLeafTagId: recoveredId,
        });
        return [{ ...tag, leafTagId: recoveredId, tagPath: pathById.get(recoveredId)! }];
      }
      dropped.push({ source: prediction.source, leafTagId: tag.leafTagId, tagPath: tag.tagPath });
      return [];
    }),
  }));

  return { predictions: next, dropped, corrected };
}

function extractTagNameVariants(name: string): string[] {
  const normalized = normalizeForMatch(name);
  const parts = normalized
    .split(/[()（）【】\[\]{}<>《》,，、|\\/>\-\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([normalized, ...parts]));
}

function isStrongPathKeyword(keyword: string): boolean {
  if (!keyword) return false;
  if (/\d/.test(keyword)) return keyword.length >= 2; // SKU0001 / v2 这类
  if (/^[a-z0-9]+$/i.test(keyword)) return keyword.length >= 3; // amazon / en
  // 中日韩字符等非纯英文，至少 2 字
  return keyword.length >= 2;
}

/**
 * 由标签名自动拆词得到的"强关键词"候选集合。审核反馈模块（keyword-feedback.ts）
 * 复用同一套规则，反推出人工拒绝某个标签时，究竟是哪个自动关键词导致了命中。
 */
export function getStrongKeywordVariantsForTagName(name: string): string[] {
  return extractTagNameVariants(name).filter(isStrongPathKeyword);
}

function collectLeafTagCandidates(tagsTree: TagWithChildren[]): Array<{
  leafTagId: number;
  tagPath: string[];
  keywords: string[];
  // 标签全名本身暗示的格式类别（如"POP-UP视频"→video），无则为 undefined。
  formatKind?: "image" | "video";
}> {
  const candidates: Array<{
    leafTagId: number;
    tagPath: string[];
    keywords: string[];
    formatKind?: "image" | "video";
  }> = [];
  for (const lv1 of tagsTree) {
    const lv2List = lv1.children ?? [];
    for (const lv2 of lv2List) {
      const lv3List = lv2.children ?? [];
      for (const leaf of lv3List) {
        // 排除掉被审核反馈（或人工配置）标记为"排除关键词"的自动拆词候选，
        // 否则硬匹配会绕开 negativeKeywords，反复复现同一个误判（如 POPUP -> POP-UP视频）。
        const negativeKeywords = new Set(
          ((leaf.extra as AssetTagExtra)?.negativeKeywords ?? []).map((keyword) =>
            normalizeForMatch(keyword),
          ),
        );
        const variants = extractTagNameVariants(leaf.name)
          .filter(isStrongPathKeyword)
          .filter((keyword) => !negativeKeywords.has(keyword));
        if (variants.length === 0) continue;
        candidates.push({
          leafTagId: leaf.id,
          tagPath: [lv1.name, lv2.name, leaf.name],
          keywords: variants,
          formatKind: detectFormatKindInText(leaf.name),
        });
      }
    }
  }
  return candidates;
}

/**
 * 在一段归一化后的文本（文件夹路径 / 文件名+描述）里找出所有能被标签名自动拆词
 * 强关键词字面命中的叶子标签，materializedPath 和 basicInfo 两个硬匹配入口共用。
 */
function computeTextHardMatchCandidates(
  tagsTree: TagWithChildren[],
  normalizedText: string,
): Array<{
  leafTagId: number;
  tagPath: string[];
  keywords: string[];
  formatKind?: "image" | "video";
  matchedKeywordLength: number;
}> {
  // 文本整体是否独立提到了图片/视频这类格式概念（不局限于命中关键词所在的那个片段），
  // 用于校验"标签名带格式关键词、但命中片段本身不带"的情况（如标签"POP-UP视频"被
  // 文本里的"pop-up"片段命中，但文本其他地方（如"video-01.mp4"）确实也提到了视频，才算数）。
  const textFormatKind = detectFormatKindInText(normalizedText);

  return collectLeafTagCandidates(tagsTree)
    .map((candidate) => {
      const matchedKeyword = candidate.keywords.find((keyword) =>
        pathIncludesKeyword(normalizedText, keyword),
      );
      if (!matchedKeyword) return undefined;
      // 标签名暗示了具体格式（图片/视频），但文本整体并未独立提到同一种格式概念——
      // 说明命中的只是标签名里跟格式无关的片段（如"POP-UP视频"里的"POP"），不足以采信。
      if (candidate.formatKind && candidate.formatKind !== textFormatKind) return undefined;
      return { ...candidate, matchedKeywordLength: matchedKeyword.length };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.matchedKeywordLength - a.matchedKeywordLength)
    .slice(0, TEXT_HARD_MATCH_MAX_ENHANCED_TAGS);
}

function injectHardMatchPredictions(
  predictions: SourceBasedTagPredictions,
  source: z.infer<typeof tagPredictionSchema.shape.source>,
  candidates: ReturnType<typeof computeTextHardMatchCandidates>,
  confidence: number,
): SourceBasedTagPredictions {
  if (candidates.length === 0) return predictions;

  const enhanced = predictions.map((prediction) => ({
    ...prediction,
    tags: [...prediction.tags],
  }));

  let bucket = enhanced.find((item) => item.source === source);
  if (!bucket) {
    bucket = { source, tags: [] };
    enhanced.push(bucket);
  }

  for (const candidate of candidates) {
    const existed = bucket.tags.find((tag) => tag.leafTagId === candidate.leafTagId);
    if (existed) {
      existed.confidence = Math.max(existed.confidence, confidence);
      continue;
    }
    bucket.tags.push({
      leafTagId: candidate.leafTagId,
      tagPath: candidate.tagPath,
      confidence,
    });
  }

  return enhanced;
}

export function enhancePredictionsByMaterializedPathHardMatch(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
  materializedPath: string,
): SourceBasedTagPredictions {
  const normalizedPath = normalizeForMatch(materializedPath);
  if (!normalizedPath) return predictions;
  const candidates = computeTextHardMatchCandidates(tagsTree, normalizedPath);
  return injectHardMatchPredictions(
    predictions,
    "materializedPath",
    candidates,
    TEXT_HARD_MATCH_CONFIDENCE,
  );
}

/**
 * 文件名/描述（basicInfo）里的强关键词做硬匹配兜底，逻辑与 materializedPath 完全对称：
 * 此前只有文件夹路径有这层代码兜底，导致文件名里明明字面出现了"Pop-up"这类关键词，
 * 却完全依赖模型是否"恰好"也从 basicInfo 角度独立给出同一个预测——模型给了就命中，
 * 没给就只能靠路径命中单独撑分，容易让人误以为"名称匹配"没生效。
 */
export function enhancePredictionsByBasicInfoHardMatch(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
  basicInfoText: string,
): SourceBasedTagPredictions {
  const normalizedText = normalizeForMatch(basicInfoText);
  if (!normalizedText) return predictions;
  const candidates = computeTextHardMatchCandidates(tagsTree, normalizedText);
  return injectHardMatchPredictions(
    predictions,
    "basicInfo",
    candidates,
    TEXT_HARD_MATCH_CONFIDENCE,
  );
}

// 常见图片/视频扩展名 -> 归一化格式标识，用于和标签路径里提到的具体格式关键词做一致性校验
const FORMAT_TAG_EXTENSION_ALIASES: Record<string, string> = {
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  svg: "svg",
  tif: "tif",
  tiff: "tif",
  heic: "heic",
  heif: "heic",
  avif: "avif",
  mp4: "mp4",
  mov: "mov",
  avi: "avi",
  wmv: "wmv",
  flv: "flv",
  mkv: "mkv",
  webm: "webm",
  m4v: "m4v",
};

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "avi",
  "wmv",
  "flv",
  "mkv",
  "webm",
  "m4v",
  "3gp",
  "mpg",
  "mpeg",
]);

// 格式类关键词的同义词组：用于在没有真实扩展名可用时，从文本（文件名/路径/标签名）里
// 识别出"这段文字暗示的是图片还是视频"，把常见格式后缀（mp4/jpg 等）和中英文词
// （视频/video/图片/image）都归一化到同一个概念下，避免"文件名写 mp4 却被当成没提到视频"。
const FORMAT_KEYWORD_GROUPS: Record<"image" | "video", string[]> = {
  image: ["图片", "照片", "image", ...Array.from(IMAGE_EXTENSIONS)],
  video: ["视频", "video", ...Array.from(VIDEO_EXTENSIONS)],
};

/**
 * 判断一段文本里是否包含图片/视频相关的格式关键词（含同义词/常见扩展名），
 * 纯字母数字关键词按词边界匹配，避免子串误命中。
 */
function detectFormatKindInText(text: string): "image" | "video" | undefined {
  const normalized = normalizeForMatch(text);
  if (!normalized) return undefined;
  for (const kind of ["image", "video"] as const) {
    for (const keyword of FORMAT_KEYWORD_GROUPS[kind]) {
      if (pathIncludesKeyword(normalized, keyword)) return kind;
    }
  }
  return undefined;
}

function normalizeExtension(extension?: string | null): string | undefined {
  const ext = (extension ?? "").toLowerCase().replace(/^\./, "").trim();
  if (!ext) return undefined;
  return FORMAT_TAG_EXTENSION_ALIASES[ext] ?? ext;
}

function getRealAssetMediaKind(extension: string): "image" | "video" | undefined {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return undefined;
}

/**
 * 用真实文件扩展名（asset.extra.extension，来自 MuseDAM）过滤掉与实际格式/媒体类型矛盾的预测标签。
 * 此前 LLM 和关键词硬匹配都不校验真实元数据，导致出现过 PNG 素材被打上"JPG"格式标签、
 * 图片素材因文件名包含 "POPUP" 被误判为"视频资产"这类幻觉标签。
 */
export function filterPredictionsByRealExtension(
  predictions: SourceBasedTagPredictions,
  rawExtension?: string | null,
  // 真实扩展名缺失时的兜底证据（文件名/描述/路径等文本）：不能验证就直接放行，
  // 会让"POP_UP_视频"这类靠标签名片段幻觉出来的格式标签在扩展名缺失时完全不受约束。
  // 退而求其次，从这些文本里找一个"格式概念"当作可信依据。
  fallbackEvidenceText?: string,
): SourceBasedTagPredictions {
  const realExtension = normalizeExtension(rawExtension);
  const realMediaKind = realExtension ? getRealAssetMediaKind(realExtension) : undefined;
  const evidenceMediaKind =
    !realMediaKind && fallbackEvidenceText
      ? detectFormatKindInText(fallbackEvidenceText)
      : undefined;
  const trustedMediaKind = realMediaKind ?? evidenceMediaKind;

  // 真实扩展名和兜底证据都拿不到任何格式信号，无法验证，只能放行（不引入新的误伤）。
  if (!trustedMediaKind) return predictions;

  const isTagContradictory = (tagPath: string[]): boolean => {
    const pathText = tagPath.join(">").toLowerCase();

    // 具体扩展名层面的矛盾校验（如标签写"jpg"但真实是"png"）只在有真实扩展名时才有意义，
    // 仅靠文本兜底证据推断不出这么精确的结论。
    if (realExtension) {
      for (const [keyword, ext] of Object.entries(FORMAT_TAG_EXTENSION_ALIASES)) {
        if (ext === realExtension) continue;
        const boundaryRegex = new RegExp(`(?<![a-z0-9])${keyword}(?![a-z0-9])`, "i");
        if (boundaryRegex.test(pathText)) return true;
      }
    }

    if (trustedMediaKind === "image" && /(视频|video|短片|影片|vlog)/i.test(pathText)) return true;
    if (trustedMediaKind === "video") {
      if (/(图片|image|照片|photo|picture)/i.test(pathText)) return true;
      // "产品组合图""白底图""主图""场景图"这类以"图"结尾的标签名都是静态图片概念，
      // 视频素材不应被打上（客户案例：MP4 被打了"素材类型 > 产品资产 > 产品组合图"）。
      if (tagPath.some((segment) => /图$/.test(segment.trim()))) return true;
    }

    return false;
  };

  return predictions.map((prediction) => ({
    ...prediction,
    tags: prediction.tags.filter((tag) => !isTagContradictory(tag.tagPath)),
  }));
}

function buildStableSeed(input: string): number {
  const hash = createHash("sha256").update(input).digest("hex");
  // 取前 8 位转正整数，作为稳定 seed；部分 OpenAI-compatible 后端不接受 unsigned 32bit 上界。
  return Number.parseInt(hash.slice(0, 8), 16) & 0x7fffffff;
}

function sortPredictionsDeterministically(
  predictions: SourceBasedTagPredictions,
): SourceBasedTagPredictions {
  const sourceOrder: Record<z.infer<typeof tagPredictionSchema.shape.source>, number> = {
    basicInfo: 0,
    materializedPath: 1,
    contentAnalysis: 2,
    tagKeywords: 3,
  };
  return [...predictions]
    .map((prediction) => ({
      ...prediction,
      tags: [...prediction.tags].sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (a.leafTagId !== b.leafTagId) return a.leafTagId - b.leafTagId;
        return a.tagPath.join("/").localeCompare(b.tagPath.join("/"));
      }),
    }))
    .sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source]);
}

/**
 * 多源标签分数计算 - 多个信息源识别同一标签时增强置信度而非简单平均
 * @returns 最终分数 0-1 范围
 */
function calculateMultiSourceScore(
  confidenceBySources: TagWithScore["confidenceBySources"],
): number {
  const dampingFactor = 0.8;
  let remaining = 1;
  let maxWeighted = 0;

  (
    Object.entries(confidenceBySources) as [keyof TagWithScore["confidenceBySources"], number][]
  ).forEach(([source, confidence]) => {
    if (confidence !== undefined && confidence !== null) {
      const weight = SCORING_WEIGHTS[source];
      const enhanced = Math.pow(confidence, weight);
      maxWeighted = Math.max(maxWeighted, enhanced);
      remaining *= 1 - enhanced * dampingFactor;
    }
  });

  const rawScore = 1 - remaining;
  return Math.max(rawScore, maxWeighted);
}

/**
 * 加权的算法不一定对，如果一个 tag 在两个 source 都有，结果应该是更高分数而不是在两个 source 的 confidence 之间的一个数值
 */
export function calculateTagScore(predictions: SourceBasedTagPredictions) {
  const tagsWithScore: TagWithScore[] = [];
  predictions.forEach(({ source, tags }) => {
    tags.forEach(({ leafTagId, tagPath, confidence }) => {
      let item = tagsWithScore.find((tag) => tag.leafTagId === leafTagId);
      if (!item) {
        item = {
          leafTagId,
          tagPath,
          confidenceBySources: {},
          score: 0,
        };
        tagsWithScore.push(item);
      }
      item.confidenceBySources[source] = confidence;
    });
  });
  tagsWithScore.forEach((item) => {
    const finalScore = calculateMultiSourceScore(item.confidenceBySources);
    item.score = Math.round(finalScore * 100);
  });
  return tagsWithScore;
}

/**
 * 用识别模式（precise/balanced/broad）对应的最低置信度门槛过滤最终结果。
 * 独立于 prompt 里给模型的门槛指令之外做一次代码层面兜底，
 * 避免"精准模式只出高置信度标签"完全依赖模型是否严格遵守 system prompt。
 */
export function filterTagsWithScoreByRecognitionAccuracy(
  tagsWithScore: TagWithScore[],
  mode: RecognitionAccuracyMode = "balanced",
): TagWithScore[] {
  const minScore = Math.round(RECOGNITION_ACCURACY_CONFIG[mode].minConfidence * 100);
  const filtered = tagsWithScore.filter((tag) => tag.score >= minScore);
  if (filtered.length > 0 || tagsWithScore.length === 0) {
    return filtered;
  }
  // 兜底：模型确实找到了候选，只是没有一个达到当前模式的门槛（常见于精准模式 + 证据本来就不够强的素材）。
  // 这种情况下不让素材彻底"零标签"，保留分数最高的那一个，交给人工审核去判断要不要采纳，
  // 比起什么都不给、逼着客户去查日志才发现"AI 其实是有猜测的，只是被门槛过滤掉了"要更可用。
  const best = [...tagsWithScore].sort((a, b) => b.score - a.score)[0];
  return [best];
}

/**
 * 祖先折叠：同一条祖先链上，更具体的标签已经过线时，它的父级/祖父级不再单独输出。
 * "内容主题 > 产品教育"和"内容主题 > 产品教育 > 产品介绍"同时出现，对审核人只是噪音。
 * 放在识别模式阈值过滤之后：三级没过线、只有二级过线时，二级仍然保留（那是"能确定到哪一级就到哪一级"）。
 */
export function collapseAncestorTags(tagsWithScore: TagWithScore[]): TagWithScore[] {
  const paths = tagsWithScore.map((tag) => tag.tagPath);
  const isStrictPrefixOfAnother = (path: string[]) =>
    paths.some(
      (other) =>
        other.length > path.length && path.every((segment, index) => other[index] === segment),
    );
  return tagsWithScore.filter((tag) => !isStrictPrefixOfAnother(tag.tagPath));
}

/**
 * 画幅组（子标签名都是 1:1 / 9:16 / 横版 之类）的标签由系统按素材真实宽高确定性打上（见 aspect-ratio.ts），
 * 模型对这些标签的猜测一律丢弃，避免"看图猜比例"与真实尺寸打架。
 */
export function dropPredictionsUnderAspectRatioGroups(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
): SourceBasedTagPredictions {
  const groups = detectAspectRatioGroups(tagsTree);
  if (groups.length === 0) return predictions;
  const { parentIds, childIds } = collectAspectRatioTagIds(groups);
  return predictions.map((prediction) => ({
    ...prediction,
    tags: prediction.tags.filter(
      (tag) => !childIds.has(tag.leafTagId) && !parentIds.has(tag.leafTagId),
    ),
  }));
}

/** 必打兜底选出的标签统一给的分数：低于平衡模式门槛，审核时一眼能看出是兜底结果。 */
export const REQUIRED_FALLBACK_SCORE = 50;

export type RequiredGroupResolution = {
  tagsWithScore: TagWithScore[];
  /** 从阈值过滤前的候选里重新纳入的标签 */
  readmitted: Array<{ parentId: number; leafTagId: number; tagPath: string[]; score: number }>;
  /** 模型完全没给候选、需要强制单选的必打分类 */
  missing: Array<{ parentId: number; parentPath: string[] }>;
};

/**
 * 必打标签组兜底（父分类 extra.requiredGroup 为 true）：每个素材都必须在该分类下打出一个后代标签。
 * - 最终结果里已有该分类的后代 → 不动；
 * - 没有，但阈值过滤前的候选里有 → 重新纳入分数最高的一个，标 origin = requiredFallback；
 * - 候选也没有 → 记入 missing，由调用方做强制单选（见 predictRequiredGroupChoices）。
 * 画幅组不在此处理（由宽高确定性打标）。互斥硬约束在更早的 resolveExclusiveSiblings 已经跑过，
 * 候选池里同一互斥父下只剩一个分支，兜底不会重新引入互斥冲突。
 */
export function ensureRequiredGroups(
  finalTags: TagWithScore[],
  allScored: TagWithScore[],
  tagsTree: TagWithChildren[],
): RequiredGroupResolution {
  const nodes = flattenTagsTree(tagsTree);
  const aspectRatioParentIds = collectAspectRatioTagIds(
    detectAspectRatioGroups(tagsTree),
  ).parentIds;
  const requiredParents = nodes.filter(
    (node) =>
      node.hasChildren &&
      getExplicitRequiredGroup(node.extra) === true &&
      !aspectRatioParentIds.has(node.id),
  );
  if (requiredParents.length === 0) {
    return { tagsWithScore: finalTags, readmitted: [], missing: [] };
  }
  const parentById = new Map<number, number>();
  for (const node of nodes) if (node.parentId !== undefined) parentById.set(node.id, node.parentId);
  const isDescendantOf = (tagId: number, ancestorId: number): boolean => {
    let current = parentById.get(tagId);
    while (current !== undefined) {
      if (current === ancestorId) return true;
      current = parentById.get(current);
    }
    return false;
  };

  const result = [...finalTags];
  const readmitted: RequiredGroupResolution["readmitted"] = [];
  const missing: RequiredGroupResolution["missing"] = [];
  for (const parent of requiredParents) {
    if (result.some((tag) => isDescendantOf(tag.leafTagId, parent.id))) continue;
    const candidate = allScored
      .filter((tag) => isDescendantOf(tag.leafTagId, parent.id))
      .sort((a, b) => b.score - a.score || a.leafTagId - b.leafTagId)[0];
    if (candidate) {
      result.push({ ...candidate, origin: "requiredFallback" });
      readmitted.push({
        parentId: parent.id,
        leafTagId: candidate.leafTagId,
        tagPath: candidate.tagPath,
        score: candidate.score,
      });
    } else {
      missing.push({ parentId: parent.id, parentPath: parent.tagPath });
    }
  }
  return { tagsWithScore: result, readmitted, missing };
}

const requiredGroupChoiceSchema = z.object({
  choices: z.array(
    z.object({
      parentId: z.number(),
      leafTagId: z.number(),
    }),
  ),
});

/**
 * 强制单选：必打分类连低分候选都没有时，单独问一次模型"在这个分类的子标签里必须选一个"。
 * 输出统一 REQUIRED_FALLBACK_SCORE 分、origin = requiredFallback；模型选了不在该分类下的 id 时按该分类
 * 第一个叶子兜底（必打的语义就是"必须有一个"，宁可给个低分让人工改，也不空着）。
 */
export async function predictRequiredGroupChoices({
  missing,
  tagsTree,
  assetSummary,
  teamId,
}: {
  missing: RequiredGroupResolution["missing"];
  tagsTree: TagWithChildren[];
  assetSummary: string;
  teamId: number;
}): Promise<TagWithScore[]> {
  if (missing.length === 0) return [];
  const nodes = flattenTagsTree(tagsTree);
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const parentById = new Map<number, number>();
  for (const node of nodes) if (node.parentId !== undefined) parentById.set(node.id, node.parentId);
  const isDescendantOf = (tagId: number, ancestorId: number): boolean => {
    let current = parentById.get(tagId);
    while (current !== undefined) {
      if (current === ancestorId) return true;
      current = parentById.get(current);
    }
    return false;
  };
  // 每个必打分类的可选叶子（没有三级时二级就是叶子）
  const leavesByParent = new Map<number, typeof nodes>();
  for (const { parentId } of missing) {
    leavesByParent.set(
      parentId,
      nodes.filter((node) => !node.hasChildren && isDescendantOf(node.id, parentId)),
    );
  }

  const groupsText = missing
    .map(({ parentId, parentPath }) => {
      const leaves = leavesByParent.get(parentId) ?? [];
      return `## 必打分类 (parentId: ${parentId}): ${parentPath.join(" > ")}\n${leaves
        .map((leaf) => `- id ${leaf.id}: ${leaf.tagPath.join(" > ")}`)
        .join("\n")}`;
    })
    .join("\n\n");

  const fallbackChoice = (parentId: number): TagWithScore | null => {
    const first = (leavesByParent.get(parentId) ?? [])[0];
    return first
      ? {
          leafTagId: first.id,
          tagPath: first.tagPath,
          confidenceBySources: { contentAnalysis: REQUIRED_FALLBACK_SCORE / 100 },
          score: REQUIRED_FALLBACK_SCORE,
          origin: "requiredFallback",
        }
      : null;
  };

  let chosen = new Map<number, number>();
  try {
    const modelName = getTaggingPredictModel();
    const result = await generateObject({
      model: llm(modelName),
      schemaName: "RequiredGroupChoices",
      schema: requiredGroupChoiceSchema,
      providerOptions: getTaggingPredictProviderOptions(modelName, teamId),
      system: `你是数字资产管理系统的打标助手。下面这些分类被管理员设置为"必打"：每个素材都必须在该分类下选出恰好一个标签，哪怕证据不足也要选最可能的那个，不允许不选。只输出 JSON：{"choices":[{"parentId":<分类 id>,"leafTagId":<所选标签 id>}]}，每个必打分类恰好一条，leafTagId 必须来自该分类下列出的候选。`,
      prompt: `# 素材信息\n${assetSummary}\n\n# 需要选择的必打分类\n${groupsText}`,
      temperature: 0,
    });
    chosen = new Map(result.object.choices.map((choice) => [choice.parentId, choice.leafTagId]));
  } catch (error) {
    console.warn("必打分类强制单选失败，按每组第一个叶子兜底", {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const tags: TagWithScore[] = [];
  for (const { parentId } of missing) {
    const leafTagId = chosen.get(parentId);
    const node = leafTagId !== undefined ? nodeById.get(leafTagId) : undefined;
    const valid = node && !node.hasChildren && isDescendantOf(node.id, parentId);
    const tag = valid
      ? ({
          leafTagId: node.id,
          tagPath: node.tagPath,
          confidenceBySources: { contentAnalysis: REQUIRED_FALLBACK_SCORE / 100 },
          score: REQUIRED_FALLBACK_SCORE,
          origin: "requiredFallback",
        } satisfies TagWithScore)
      : fallbackChoice(parentId);
    if (tag) tags.push(tag);
  }
  return tags;
}

/**
 * 使用AI预测内容素材的最适合标签
 * @param asset 内容素材对象
 * @param availableTags 可用的标签列表（包含层级关系）
 * @returns 预测结果数组，包含标签路径和置信度
 */
export async function predictAssetTags(
  asset: AssetObject,
  options?: {
    matchingSources?: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy?: RecognitionAccuracyMode;
    faceFeatures?: TaggingFaceFeatures;
    /** 调用方已加载好的标签树（如队列同一批次内按团队复用），传入时跳过数据库查询。 */
    tagsTree?: TagWithChildren[];
  },
): Promise<{
  predictions: SourceBasedTagPredictions;
  tagsWithScore: TagWithScore[];
  extra: TaggingQueueItemExtra;
}> {
  // 识别模式：决定 system prompt 的语气引导，以及最终产出标签的最低置信度门槛
  const recognitionAccuracyMode = options?.recognitionAccuracy ?? "balanced";

  // 未显式传入时视为全部启用，保持旧调用方（如测试页）不受影响。
  const enabled = options?.matchingSources ?? {
    basicInfo: true,
    materializedPath: true,
    contentAnalysis: true,
    tagKeywords: true,
  };
  if (
    !enabled.basicInfo &&
    !enabled.materializedPath &&
    !enabled.contentAnalysis &&
    !enabled.tagKeywords
  ) {
    throw taggingPredictError("NO_MATCHING_SOURCES_ENABLED", "No matching sources enabled");
  }

  const tagsTree = options?.tagsTree ?? (await fetchTagsTreeForTagging({ teamId: asset.teamId }));
  if (!tagsTree || tagsTree.length === 0) {
    throw taggingPredictError("NO_TAG_TREE", "No tag tree available");
  }
  // 构建标签结构的文本描述
  const tagStructureText = buildTagStructureText(tagsTree);
  // 构建标签关键词信息：仅在 tagKeywords 信息源启用时才需要，否则不应该出现在 prompt 里
  // ——不然即使用户关闭了"已有标签匹配"，模型依然会看到完整关键词库并可能受其影响。
  const tagKeywordsText = enabled.tagKeywords ? buildTagKeywordsText(tagsTree) : undefined;
  const peopleCountTagPaths = options?.faceFeatures ? collectPeopleCountTagPaths(tagsTree) : [];
  const faceFeaturesSection = buildFaceFeaturesPromptSection(
    options?.faceFeatures,
    peopleCountTagPaths,
  );

  const realExtension = normalizeExtension((asset.extra as AssetObjectExtra | null)?.extension);
  const realMediaKind = realExtension ? getRealAssetMediaKind(realExtension) : undefined;
  const realFormatFactText = realExtension
    ? `该素材的真实文件格式为：${realMediaKind === "video" ? "视频" : realMediaKind === "image" ? "图片" : "未知类型"}（.${realExtension}）。这是系统确定性事实，请以此为准判断素材类型/格式相关标签，不要仅凭文件名或标签名称中恰好出现的文字（如"视频"二字恰好是某个标签名称的一部分）来推断格式，若标签暗示的格式与该事实矛盾，禁止选用该标签。`
    : "该素材的真实文件格式未知（系统未提供）。请对格式类标签更加谨慎，不要仅凭文件名或标签名称中的字面文字武断下结论。";

  // aiTags 是同一次视觉分析产出的通用标签自由文本，和 aiDescription 内容高度重叠，
  // 却给了模型更多"风格/氛围类"词汇去误推元数据类标签（如渠道）——只保留 aiDescription，
  // 不再把 aiTags 拼进 prompt，减少无关文本对模型的干扰。
  const aiDescription = (asset.content as AssetObjectContentAnalysis)?.aiDescription;

  // 每个信息源的文本只在对应设置启用时才拼进 prompt——被关闭的信息源必须真正"不可见"，
  // 而不是喂给模型之后再事后过滤模型自报的 source 标签（那样关闭形同虚设，见下方 matchingSources 过滤）。
  const sourceSections: string[] = [];
  if (enabled.basicInfo) {
    sourceSections.push(`## basicInfo信息源
文件名：${asset.name}
文件描述：${asset.description || "无"}
真实文件格式事实：${realFormatFactText}`);
  }
  if (enabled.materializedPath) {
    sourceSections.push(`## materializedPath信息源
文件路径：${asset.materializedPath}`);
  }
  if (enabled.contentAnalysis) {
    sourceSections.push(`## contentAnalysis信息源
内容分析：${aiDescription || "无有效内容数据"}`);
  }
  if (enabled.tagKeywords) {
    sourceSections.push(`## tagKeywords信息源
标签关键词匹配：请根据上述标签关键词配置，分析素材信息是否匹配到任何标签的匹配关键词，同时注意排除包含排除关键词的情况。${faceFeaturesSection}`);
  }

  const messages: UserModelMessage[] = [
    {
      role: "user",
      content: `# 可用标签体系
${tagStructureText}${
        tagKeywordsText
          ? `

# 标签关键词配置
${tagKeywordsText}`
          : ""
      }`,
      providerOptions: { bedrock: { cachePoint: { type: "default" } } },
    },
    {
      role: "user",
      content: `# 待分析内容素材信息

本次仅启用以下信息源，未列出的信息源视为未启用，不参与本次分析、也不应出现在输出的 predictions 里。

${sourceSections.join("\n\n")}

请按照 system 的 Step by Step 流程进行分析，但【最终只输出包含 predictions 数组的纯 JSON 对象】（不要解释、不要 markdown、不要 \`\`\`、不要任何额外文本）。`,
    },
  ];

  // 用于返回，记录在数据库里
  const inputPrompt = messages[1].content as string;
  const stableSeed = buildStableSeed(
    JSON.stringify({
      teamId: asset.teamId,
      name: asset.name,
      description: asset.description ?? "",
      materializedPath: asset.materializedPath,
      contentAiDescription: aiDescription ?? "",
      realExtension: realExtension ?? "",
      matchingSources: options?.matchingSources ?? null,
      recognitionAccuracy: options?.recognitionAccuracy ?? null,
      // Only include when present so existing no-faceFeatures calls keep the same seed.
      ...(options?.faceFeatures ? { faceFeatures: options.faceFeatures } : {}),
      tagsTree,
    }),
  );

  const maxAttempts = 3; // 初次 + 重试2次
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const modelName = getTaggingPredictModel();
      const result = await generateObject({
        // model: llm("claude-sonnet-4"),
        // model: llm("gpt-5-nano"),
        model: llm(modelName),
        schemaName: "TagPredictions",
        schemaDescription:
          '返回 JSON 对象 {"predictions":[...]}；predictions 元素包含 source("basicInfo"|"materializedPath"|"contentAnalysis"|"tagKeywords") 和 tags；tags 元素包含 confidence(0-1)、leafTagId(number)、tagPath(string[])。只输出纯 JSON。',
        providerOptions: getTaggingPredictProviderOptions(modelName, asset.teamId),
        schema: tagPredictionsResponseSchema,
        system: tagPredictionSystemPrompt(recognitionAccuracyMode),
        messages,
        temperature: 0,
        seed: stableSeed,
        experimental_repairText: async (res: { text: string }) => {
          // 尝试提取并包装为对象，满足 OpenAI Structured Outputs 的根 schema 限制
          return repairToPredictionEnvelopeText(res.text, { attempt });
        },
      });

      if (!result.object) {
        throw new Error("AI标签预测失败, result.object is undefined");
      }

      let predictions = result.object.predictions;
      // 根据 matchingSources 过滤结果
      if (options?.matchingSources) {
        const enabledSources = Object.entries(options.matchingSources)
          .filter(([, enabled]) => enabled)
          .map(([source]) => source as keyof typeof options.matchingSources);
        if (enabledSources.length === 0) {
          throw taggingPredictError("NO_MATCHING_SOURCES_ENABLED", "No matching sources enabled");
        }

        predictions = predictions.filter((prediction) =>
          enabledSources.includes(prediction.source as keyof typeof options.matchingSources),
        );
      }

      // 先把模型幻觉出来的 leafTagId 挡在最前面：后续所有规则都以 id 为准，
      // 硬匹配注入的 id 来自 tagsTree 本身，不需要再校验。
      const knownTagsResult = filterPredictionsByKnownTagIds(predictions, tagsTree);
      predictions = knownTagsResult.predictions;
      // 画幅组由系统按真实宽高确定性打标，模型对这些标签的猜测不采纳。
      predictions = dropPredictionsUnderAspectRatioGroups(predictions, tagsTree);
      if (knownTagsResult.dropped.length > 0 || knownTagsResult.corrected.length > 0) {
        console.warn("AI标签预测: 存在不在标签树中的 leafTagId", {
          teamId: asset.teamId,
          assetObjectId: asset.id,
          attempt,
          dropped: knownTagsResult.dropped,
          corrected: knownTagsResult.corrected,
        });
      }

      // 字面型标签（渠道/市场/活动/档期等）在每个来源下都必须有字面证据兜底，不能只靠 prompt 指令让模型自觉。
      // contentAnalysis 证据文本就是喂给模型的视觉分析原文；tagKeywords / basicInfo 看文件名/描述/路径；
      // materializedPath 看路径。模型摘录的 evidence 片段也会拿来跟这些原文比对。
      const basicInfoText = normalizeForMatch(
        [asset.name, asset.description].filter(Boolean).join(" "),
      );
      const pathText = normalizeForMatch(asset.materializedPath ?? "");
      predictions = enforceLiteralEvidenceForMetadataTags(predictions, tagsTree, {
        contentAnalysis: enabled.contentAnalysis
          ? normalizeForMatch(aiDescription ?? "")
          : undefined,
        tagKeywords: enabled.tagKeywords ? [basicInfoText, pathText].join(" ") : undefined,
        basicInfo: enabled.basicInfo ? basicInfoText : undefined,
        materializedPath: enabled.materializedPath ? pathText : undefined,
      });
      // 文本类来源的每条预测（不论标签类型）都必须在对应文字里有依据，堵住"顺手多标一个来源"抬分。
      predictions = enforceTextualSourceEvidence(predictions, tagsTree, {
        basicInfo: enabled.basicInfo ? basicInfoText : undefined,
        materializedPath: enabled.materializedPath ? pathText : undefined,
        tagKeywords: enabled.tagKeywords ? [basicInfoText, pathText].join(" ") : undefined,
      });

      // 文件夹路径中的强关键词做硬匹配兜底，避免模型漏掉明显路径信号
      if (options?.matchingSources?.materializedPath) {
        predictions = enhancePredictionsByMaterializedPathHardMatch(
          predictions,
          tagsTree,
          asset.materializedPath,
        );
      }
      // 文件名/描述中的强关键词同样做硬匹配兜底，逻辑与上面路径硬匹配对称——
      // 避免"文件名里明明写着 Pop-up"却因为模型没有独立从 basicInfo 角度给出预测，
      // 导致该标签只挂了 materializedPath 一个来源，显得"名称没匹配上"。
      if (enabled.basicInfo) {
        predictions = enhancePredictionsByBasicInfoHardMatch(
          predictions,
          tagsTree,
          [asset.name, asset.description].filter(Boolean).join(" "),
        );
      }
      // 用真实文件扩展名兜底过滤，避免格式/媒体类型（图片 vs 视频）与实际元数据矛盾的幻觉标签；
      // 真实扩展名缺失时，退而求其次用文件名/描述/路径文本做兜底证据，而不是直接放弃校验。
      predictions = filterPredictionsByRealExtension(
        predictions,
        (asset.extra as AssetObjectExtra | null)?.extension,
        [asset.name, asset.description, asset.materializedPath].filter(Boolean).join(" "),
      );
      // 同级互斥兜底：文件名说了修护霜，就不该再仅凭画面猜洁面/喷雾（硬匹配注入已完成，可作为锚定依据）。
      predictions = resolveExclusiveSiblings(predictions, tagsTree);
      predictions = sortPredictionsDeterministically(predictions);

      // 按识别模式的最低置信度门槛过滤：LLM 不一定严格遵守 prompt 里的门槛要求，
      // 这里做代码层面的兜底，确保"精准模式只出高置信度标签"是硬约束而非纯靠模型自觉。
      const allScored = calculateTagScore(predictions);
      const modelTagsWithScore = collapseAncestorTags(
        filterTagsWithScoreByRecognitionAccuracy(allScored, recognitionAccuracyMode),
      );

      // LLM 返回空/不可用结果：重试（以模型自身结果为准，必打兜底不参与这个判断）
      if (modelTagsWithScore.length === 0) {
        throw taggingPredictError("NO_VALID_TAGS", "No valid tags predicted");
      }

      // 必打标签组兜底：先从阈值过滤前的候选里捞，捞不到再强制单选一次。
      const required = ensureRequiredGroups(modelTagsWithScore, allScored, tagsTree);
      const forcedChoices = await predictRequiredGroupChoices({
        missing: required.missing,
        tagsTree,
        teamId: asset.teamId,
        assetSummary: [
          `文件名：${asset.name}`,
          `文件描述：${asset.description || "无"}`,
          `文件路径：${asset.materializedPath || "无"}`,
          `内容分析：${aiDescription || "无"}`,
        ].join("\n"),
      });
      const tagsWithScore = [...required.tagsWithScore, ...forcedChoices];
      const requiredGroupFallback =
        required.readmitted.length > 0 || forcedChoices.length > 0
          ? {
              readmitted: required.readmitted,
              forced: forcedChoices.map((tag) => ({
                leafTagId: tag.leafTagId,
                tagPath: tag.tagPath,
              })),
            }
          : undefined;

      return {
        predictions,
        tagsWithScore,
        extra: {
          usage: result.usage,
          input: inputPrompt,
          matchingSources: options?.matchingSources,
          recognitionAccuracy: options?.recognitionAccuracy,
          ...(requiredGroupFallback ? { requiredGroupFallback } : {}),
          ...(options?.faceFeatures ? { faceFeatures: options.faceFeatures } : {}),
        },
      };
    } catch (error) {
      // 标签树为空不重试
      const code = getErrorCode(error);
      if (code === "NO_TAG_TREE" || code === "NO_MATCHING_SOURCES_ENABLED") {
        throw error;
      }
      lastError = error;
    }
  }

  // NO_VALID_TAGS 属于常见的可预期失败（例如素材信息不足/无匹配标签），避免刷屏打印 stack
  const lastErrorCode = getErrorCode(lastError);
  if (lastErrorCode !== "NO_VALID_TAGS" && lastErrorCode !== "NO_MATCHING_SOURCES_ENABLED") {
    console.error("AI标签预测失败:", lastError);
  }
  if (lastErrorCode === "NO_MATCHING_SOURCES_ENABLED") {
    throw taggingPredictError(
      "NO_MATCHING_SOURCES_ENABLED",
      "AI tagging failed: no source enabled",
    );
  }
  throw taggingPredictError("NO_VALID_TAGS", "AI tagging failed: no valid tags");
}
