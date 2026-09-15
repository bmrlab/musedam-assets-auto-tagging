import "server-only";

import { createHash } from "node:crypto";
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
import z from "zod";
import { buildFaceFeaturesPromptSection, collectPeopleCountTagPaths } from "./face-features";
import {
  RECOGNITION_ACCURACY_CONFIG,
  RecognitionAccuracyMode,
  tagPredictionSystemPrompt,
} from "./prompt";
import { SourceBasedTagPredictions, tagPredictionSchema, TagWithScore } from "./types";
import { buildTagKeywordsText, buildTagStructureText, fetchTagsTree } from "./utils";

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

function repairToPredictionEnvelopeText(text: string): string {
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
    return '{"predictions":[]}';
  } catch {}

  // 截取 [] 范围
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) return '{"predictions":[]}';

  let candidate = cleaned.slice(start, end + 1);

  // 兜底：修复常见的 JSON 语法错误
  candidate = candidate
    .replace(/,\s*]/g, "]") // 移除末尾多余的逗号
    .replace(/([{,])\s*(\w+):/g, '$1"$2":') // 补全属性名的引号
    .replace(/:\s*([^"[\d{,}]+?)([,}])/g, ':"$1"$2'); // 给字符串值补全引号

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed)
      ? JSON.stringify({ predictions: parsed })
      : '{"predictions":[]}';
  } catch {
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

const MATERIALIZED_PATH_HARD_MATCH_CONFIDENCE = 0.9;
const MATERIALIZED_PATH_MAX_ENHANCED_TAGS = 12;

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

export function enhancePredictionsByMaterializedPathHardMatch(
  predictions: SourceBasedTagPredictions,
  tagsTree: TagWithChildren[],
  materializedPath: string,
): SourceBasedTagPredictions {
  const normalizedPath = normalizeForMatch(materializedPath);
  if (!normalizedPath) return predictions;

  // 路径整体是否独立提到了图片/视频这类格式概念（不局限于命中关键词所在的那个片段），
  // 用于校验"标签名带格式关键词、但命中片段本身不带"的情况（如标签"POP-UP视频"被
  // 路径里的"pop-up"片段命中，但路径其他地方（如"video-01.mp4"）确实也提到了视频，才算数）。
  const pathFormatKind = detectFormatKindInText(normalizedPath);

  const candidates = collectLeafTagCandidates(tagsTree)
    .map((candidate) => {
      const matchedKeyword = candidate.keywords.find((keyword) =>
        pathIncludesKeyword(normalizedPath, keyword),
      );
      if (!matchedKeyword) return undefined;
      // 标签名暗示了具体格式（图片/视频），但路径整体并未独立提到同一种格式概念——
      // 说明命中的只是标签名里跟格式无关的片段（如"POP-UP视频"里的"POP"），不足以采信。
      if (candidate.formatKind && candidate.formatKind !== pathFormatKind) return undefined;
      return { ...candidate, matchedKeywordLength: matchedKeyword.length };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.matchedKeywordLength - a.matchedKeywordLength)
    .slice(0, MATERIALIZED_PATH_MAX_ENHANCED_TAGS);

  if (candidates.length === 0) return predictions;

  const enhanced = predictions.map((prediction) => ({
    ...prediction,
    tags: [...prediction.tags],
  }));

  let materializedPathPrediction = enhanced.find((item) => item.source === "materializedPath");
  if (!materializedPathPrediction) {
    materializedPathPrediction = { source: "materializedPath", tags: [] };
    enhanced.push(materializedPathPrediction);
  }

  for (const candidate of candidates) {
    const existed = materializedPathPrediction.tags.find((tag) => tag.leafTagId === candidate.leafTagId);
    if (existed) {
      existed.confidence = Math.max(existed.confidence, MATERIALIZED_PATH_HARD_MATCH_CONFIDENCE);
      continue;
    }
    materializedPathPrediction.tags.push({
      leafTagId: candidate.leafTagId,
      tagPath: candidate.tagPath,
      confidence: MATERIALIZED_PATH_HARD_MATCH_CONFIDENCE,
    });
  }

  return enhanced;
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
    !realMediaKind && fallbackEvidenceText ? detectFormatKindInText(fallbackEvidenceText) : undefined;
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

    if (trustedMediaKind === "image" && /(视频|video)/i.test(pathText)) return true;
    if (trustedMediaKind === "video" && /(图片|image|照片)/i.test(pathText)) return true;

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
  if (!enabled.basicInfo && !enabled.materializedPath && !enabled.contentAnalysis && !enabled.tagKeywords) {
    throw taggingPredictError("NO_MATCHING_SOURCES_ENABLED", "No matching sources enabled");
  }

  // TODO: 缓存
  const tagsTree = await fetchTagsTree({ teamId: asset.teamId });
  if (!tagsTree || tagsTree.length === 0) {
    throw taggingPredictError("NO_TAG_TREE", "No tag tree available");
  }
  // 构建标签结构的文本描述
  const tagStructureText = buildTagStructureText(tagsTree);
  // 构建标签关键词信息：仅在 tagKeywords 信息源启用时才需要，否则不应该出现在 prompt 里
  // ——不然即使用户关闭了"已有标签匹配"，模型依然会看到完整关键词库并可能受其影响。
  const tagKeywordsText = enabled.tagKeywords ? buildTagKeywordsText(tagsTree) : undefined;
  const peopleCountTagPaths = options?.faceFeatures
    ? collectPeopleCountTagPaths(tagsTree)
    : [];
  const faceFeaturesSection = buildFaceFeaturesPromptSection(
    options?.faceFeatures,
    peopleCountTagPaths,
  );

  const realExtension = normalizeExtension((asset.extra as AssetObjectExtra | null)?.extension);
  const realMediaKind = realExtension ? getRealAssetMediaKind(realExtension) : undefined;
  const realFormatFactText = realExtension
    ? `该素材的真实文件格式为：${realMediaKind === "video" ? "视频" : realMediaKind === "image" ? "图片" : "未知类型"}（.${realExtension}）。这是系统确定性事实，请以此为准判断素材类型/格式相关标签，不要仅凭文件名或标签名称中恰好出现的文字（如"视频"二字恰好是某个标签名称的一部分）来推断格式，若标签暗示的格式与该事实矛盾，禁止选用该标签。`
    : "该素材的真实文件格式未知（系统未提供）。请对格式类标签更加谨慎，不要仅凭文件名或标签名称中的字面文字武断下结论。";

  const aiTags = (asset.content as AssetObjectContentAnalysis)?.aiTags;

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
内容分析：${(asset.content as AssetObjectContentAnalysis)?.aiDescription || "无有效内容数据"}
AI通用标签：${aiTags || "无"}（与上面的内容分析同属一次视觉分析结果，不构成独立于内容分析之外的另一条证据）`);
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
      contentAiDescription: (asset.content as AssetObjectContentAnalysis)?.aiDescription ?? "",
      contentAiTags: aiTags ?? "",
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
          return repairToPredictionEnvelopeText(res.text);
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
          throw taggingPredictError(
            "NO_MATCHING_SOURCES_ENABLED",
            "No matching sources enabled",
          );
        }

        predictions = predictions.filter((prediction) =>
          enabledSources.includes(prediction.source as keyof typeof options.matchingSources),
        );
      }

      // 文件夹路径中的强关键词做硬匹配兜底，避免模型漏掉明显路径信号
      if (options?.matchingSources?.materializedPath) {
        predictions = enhancePredictionsByMaterializedPathHardMatch(
          predictions,
          tagsTree,
          asset.materializedPath,
        );
      }
      // 用真实文件扩展名兜底过滤，避免格式/媒体类型（图片 vs 视频）与实际元数据矛盾的幻觉标签；
      // 真实扩展名缺失时，退而求其次用文件名/描述/路径文本做兜底证据，而不是直接放弃校验。
      predictions = filterPredictionsByRealExtension(
        predictions,
        (asset.extra as AssetObjectExtra | null)?.extension,
        [asset.name, asset.description, asset.materializedPath].filter(Boolean).join(" "),
      );
      predictions = sortPredictionsDeterministically(predictions);

      // 按识别模式的最低置信度门槛过滤：LLM 不一定严格遵守 prompt 里的门槛要求，
      // 这里做代码层面的兜底，确保"精准模式只出高置信度标签"是硬约束而非纯靠模型自觉。
      const tagsWithScore = filterTagsWithScoreByRecognitionAccuracy(
        calculateTagScore(predictions),
        recognitionAccuracyMode,
      );

      // LLM 返回空/不可用结果：重试
      if (tagsWithScore.length === 0) {
        throw taggingPredictError("NO_VALID_TAGS", "No valid tags predicted");
      }

      return {
        predictions,
        tagsWithScore,
        extra: {
          usage: result.usage,
          input: inputPrompt,
          matchingSources: options?.matchingSources,
          recognitionAccuracy: options?.recognitionAccuracy,
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
    throw taggingPredictError("NO_MATCHING_SOURCES_ENABLED", "AI tagging failed: no source enabled");
  }
  throw taggingPredictError("NO_VALID_TAGS", "AI tagging failed: no valid tags");
}
