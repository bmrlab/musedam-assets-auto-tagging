import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, AssetObjectContentAnalysis, TaggingQueueItemExtra } from "@/prisma/client";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { generateObject, UserModelMessage } from "ai";
import z from "zod";
import { tagPredictionSystemPrompt } from "./prompt";
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
function repairToJsonArrayText(text: string): string {
  const cleaned = (text ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // 尝试直接解析
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? cleaned : "[]";
  } catch {}

  // 截取 [] 范围
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) return "[]";

  let candidate = cleaned.slice(start, end + 1);

  // 兜底：修复常见的 JSON 语法错误
  candidate = candidate
    .replace(/,\s*]/g, "]") // 移除末尾多余的逗号
    .replace(/([{,])\s*(\w+):/g, '$1"$2":') // 补全属性名的引号
    .replace(/:\s*([^"[\d{,}]+?)([,}])/g, ':"$1"$2'); // 给字符串值补全引号

  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? candidate : "[]";
  } catch {
    return "[]";
  }
}

// export const WeightOfSource: Record<z.Infer<typeof tagPredictionSchema.shape.source>, number> = {
//   basicInfo: 35,
//   materializedPath: 30,
//   contentAnalysis: 25,
//   tagKeywords: 10,
// };

// 多源标签分数计算权重配置
const SCORING_WEIGHTS: Record<z.Infer<typeof tagPredictionSchema.shape.source>, number> = {
  basicInfo: 0.7,
  materializedPath: 0.75,
  contentAnalysis: 0.85,
  tagKeywords: 0.95,
};

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
    recognitionAccuracy?: "precise" | "balanced" | "broad";
  },
): Promise<{
  predictions: SourceBasedTagPredictions;
  tagsWithScore: TagWithScore[];
  extra: TaggingQueueItemExtra;
}> {
  // TODO: 缓存
  const tagsTree = await fetchTagsTree({ teamId: asset.teamId });
  if (!tagsTree || tagsTree.length === 0) {
    throw taggingPredictError("NO_TAG_TREE", "No tag tree available");
  }
  // 构建标签结构的文本描述
  const tagStructureText = buildTagStructureText(tagsTree);
  // 构建标签关键词信息
  const tagKeywordsText = buildTagKeywordsText(tagsTree);

  const messages: UserModelMessage[] = [
    {
      role: "user",
      content: `# 可用标签体系
${tagStructureText}

# 标签关键词配置
${tagKeywordsText}`,
      providerOptions: { bedrock: { cachePoint: { type: "default" } } },
    },
    {
      role: "user",
      content: `# 待分析内容素材信息

## basicInfo信息源
文件名：${asset.name}
文件描述：${asset.description || "无"}

## materializedPath信息源
文件路径：${asset.materializedPath}

## contentAnalysis信息源
内容分析：${(asset.content as AssetObjectContentAnalysis)?.aiDescription || "无有效内容数据"}

## tagKeywords信息源
标签关键词匹配：请根据上述标签关键词配置，分析素材信息是否匹配到任何标签的匹配关键词，同时注意排除包含排除关键词的情况。

请按照 system 的 Step by Step 流程进行分析，但【最终只输出纯 JSON 数组】（不要解释、不要 markdown、不要 \`\`\`、不要任何额外文本）。`,
    },
  ];

  // 用于返回，记录在数据库里
  const inputPrompt = messages[1].content as string;

  const maxAttempts = 3; // 初次 + 重试2次
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await generateObject({
        // model: llm("claude-sonnet-4"),
        // model: llm("gpt-5-nano"),
        model: llm("gpt-5-mini"),
        schemaName: "TagPredictions",
        schemaDescription:
          '返回 JSON 数组；元素包含 source("basicInfo"|"materializedPath"|"contentAnalysis"|"tagKeywords") 和 tags；tags 元素包含 confidence(0-1)、leafTagId(number)、tagPath(string[])。只输出纯 JSON。',
        providerOptions: {
          // azure openai provider 这里也是 openai
          openai: {
            promptCacheKey: `musedam-t-${asset.teamId}`,
            reasoningSummary: "auto", // 'auto' | 'detailed'
            reasoningEffort: "minimal", // 'minimal' | 'low' | 'medium' | 'high'
          } satisfies OpenAIResponsesProviderOptions,
        },
        schema: z.array(tagPredictionSchema),
        system: tagPredictionSystemPrompt(),
        messages,
        experimental_repairText: async (res: { text: string }) => {
          // 尝试从模型返回中提取可解析的 JSON 数组，避免因夹带解释/markdown 导致解析失败
          return repairToJsonArrayText(res.text);
        },
      });

      if (!result.object) {
        throw new Error("AI标签预测失败, result.object is undefined");
      }

      let predictions = result.object;

      // 根据 matchingSources 过滤结果
      if (options?.matchingSources) {
        const enabledSources = Object.entries(options.matchingSources)
          .filter(([, enabled]) => enabled)
          .map(([source]) => source as keyof typeof options.matchingSources);

        predictions = predictions.filter((prediction) =>
          enabledSources.includes(prediction.source as keyof typeof options.matchingSources),
        );
      }

      const tagsWithScore = calculateTagScore(predictions);

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
        },
      };
    } catch (error) {
      // 标签树为空不重试
      if (getErrorCode(error) === "NO_TAG_TREE") {
        throw error;
      }
      lastError = error;
    }
  }

  // NO_VALID_TAGS 属于常见的可预期失败（例如素材信息不足/无匹配标签），避免刷屏打印 stack
  const lastErrorCode = getErrorCode(lastError);
  if (lastErrorCode !== "NO_VALID_TAGS") {
    console.error("AI标签预测失败:", lastError);
  }
  throw taggingPredictError("NO_VALID_TAGS", "AI tagging failed: no valid tags");
}
