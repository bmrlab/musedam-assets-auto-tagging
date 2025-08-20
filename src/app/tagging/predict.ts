import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, TagWithChildren } from "@/prisma/client";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { generateObject, UserModelMessage } from "ai";
import { tagPredictionSystemPrompt } from "./prompt";
import { SourceBasedTagPredictions, tagPredictionSchema } from "./types";
import { buildTagStructureText } from "./utils";

/**
 * 使用AI预测内容素材的最适合标签
 * @param asset 内容素材对象
 * @param availableTags 可用的标签列表（包含层级关系）
 * @returns 预测结果数组，包含标签路径和置信度
 */
export async function predictAssetTags(
  asset: AssetObject,
  availableTags: TagWithChildren[],
): Promise<{
  predictions: SourceBasedTagPredictions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra: any;
}> {
  // 构建标签结构的文本描述
  const tagStructureText = buildTagStructureText(availableTags);

  // 解析asset的tags字段
  let existingTags: string[] = [];
  try {
    existingTags = typeof asset.tags === "string" ? JSON.parse(asset.tags) : asset.tags;
  } catch {
    existingTags = [];
  }

  // 解析asset的content字段
  let contentData: Record<string, any> = {};
  try {
    contentData = typeof asset.content === "string" ? JSON.parse(asset.content) : asset.content;
  } catch {
    contentData = {};
  }

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
内容分析：${Object.keys(contentData).length > 0 ? JSON.stringify(contentData, null, 2) : "无有效内容数据"}

请按照既定的Step by Step流程进行分析并输出结果。`,
    },
  ];

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

    return {
      predictions: result.object,
      extra: { usage: result.usage },
    };
  } catch (error) {
    console.error("AI标签预测失败:", error);
    throw new Error("AI标签预测失败");
  }
}
