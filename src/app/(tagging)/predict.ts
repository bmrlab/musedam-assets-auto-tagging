import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, AssetObjectContentAnalysis, TaggingQueueItemExtra } from "@/prisma/client";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { generateObject, UserModelMessage } from "ai";
import z from "zod";
import { tagPredictionSystemPrompt } from "./prompt";
import { SourceBasedTagPredictions, tagPredictionSchema, TagWithScore } from "./types";
import { buildTagStructureText, fetchTagsTree } from "./utils";

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
  // 构建标签结构的文本描述
  const tagStructureText = buildTagStructureText(tagsTree);

  const messages: UserModelMessage[] = [
    {
      role: "user",
      content: `# 可用标签体系
${tagStructureText}`,
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

请按照既定的Step by Step流程进行分析并输出结果。`,
    },
  ];

  // 用于返回，记录在数据库里
  const inputPrompt = messages[1].content as string;

  try {
    const result = await generateObject({
      // model: llm("claude-sonnet-4"),
      // model: llm("gpt-5-nano"),
      model: llm("gpt-5-mini"),
      output: "array",
      providerOptions: {
        // azure openai provider 这里也是 openai
        openai: {
          promptCacheKey: `musedam-t-${asset.teamId}`,
          reasoningSummary: "auto", // 'auto' | 'detailed'
          reasoningEffort: "minimal", // 'minimal' | 'low' | 'medium' | 'high'
        } satisfies OpenAIResponsesProviderOptions,
      },
      schema: tagPredictionSchema,
      system: tagPredictionSystemPrompt(),
      messages,
    });

    // console.log(result.object);
    // console.log(result.usage, result.providerMetadata);
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
    console.error("AI标签预测失败:", error);
    throw new Error("AI标签预测失败");
  }
}
