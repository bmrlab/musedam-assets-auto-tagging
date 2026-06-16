import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import { Locale, getLanguageConfig } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import type { ServerActionResult } from "@/lib/serverAction";
import { generateObject } from "ai";
import { z } from "zod";

const tagTreeSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string().describe("一级标签名称"),
      children: z
        .array(
          z.object({
            name: z.string().describe("二级标签名称"),
            children: z
              .array(
                z.object({
                  name: z.string().describe("三级标签名称"),
                }),
              )
              .optional()
              .describe("三级标签列表"),
          }),
        )
        .optional()
        .describe("二级标签列表"),
    }),
  ),
});

function convertStructuredToText(data: z.infer<typeof tagTreeSchema>): string {
  const lines: string[] = [];

  for (const level1 of data.tags) {
    lines.push(`# ${level1.name}`);

    if (level1.children && level1.children.length > 0) {
      for (const level2 of level1.children) {
        lines.push(`## ${level2.name}`);

        if (level2.children && level2.children.length > 0) {
          for (const level3 of level2.children) {
            lines.push(level3.name);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

function getTagTreeGenerateModel(): LLMModelName {
  return (process.env.TAG_TREE_GENERATE_MODEL?.trim() || "claude-sonnet-4-6") as LLMModelName;
}

const TAG_TREE_GENERATE_RETRY_TIMES = Number(process.env.TAG_TREE_GENERATE_RETRY_TIMES ?? 3);

/** 供 Server Action 与 HTTP API 共用，避免长耗时走 RSC Flight 被网关/代理破坏 */
export async function executeGenerateTagTreeByLLM({
  finalPrompt,
  lang,
  teamId,
  requestId,
}: {
  finalPrompt: string;
  lang: Locale;
  teamId: number;
  requestId?: string;
}): Promise<ServerActionResult<{ text: string; input: string }>> {
  try {
    rootLogger.info({
      msg: "generateTagTreeByLLM: 开始生成",
      requestId,
      teamId,
      promptLength: finalPrompt.length,
      lang,
      model: getTagTreeGenerateModel(),
    });

    const config = getLanguageConfig(lang);

    const baseStructuredPrompt = `${finalPrompt}

${config.promptIntro}
{
  "tags": [
    {
      "name": "${config.level1Label}",
      "children": [
        {
          "name": "${config.level2Label}",
          "children": [
            { "name": "${config.level3Label1}" },
            { "name": "${config.level3Label2}" }
          ]
        }
      ]
    }
  ]
}

${config.notes}`;

    const modelName = getTagTreeGenerateModel();
    let lastError: unknown;
    let textOutput = "";
    let structuredData: z.infer<typeof tagTreeSchema> | null = null;

    for (let attempt = 1; attempt <= TAG_TREE_GENERATE_RETRY_TIMES; attempt++) {
      try {
        const structuredPrompt = `${baseStructuredPrompt}

必须严格返回一个 JSON 对象，不要返回 markdown 代码块，不要返回解释文本。`;
        const result = await generateObject({
          model: llm(modelName),
          mode: "json",
          schema: tagTreeSchema,
          schemaName: config.schemaName,
          schemaDescription: config.schemaDescription,
          prompt: structuredPrompt,
        });

        structuredData = result.object;
        textOutput = convertStructuredToText(result.object);
        break;
      } catch (error) {
        lastError = error;
        rootLogger.warn({
          msg: "generateTagTreeByLLM: 结构化解析失败，准备重试",
          requestId,
          teamId,
          attempt,
          maxAttempts: TAG_TREE_GENERATE_RETRY_TIMES,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!structuredData) {
      throw lastError instanceof Error
        ? lastError
        : new Error("TAG_TREE_GENERATE_FAILED_AFTER_RETRIES");
    }

    rootLogger.info({
      msg: "generateTagTreeByLLM: 生成成功",
      requestId,
      teamId,
      structuredData,
      textOutput,
    });

    return {
      success: true,
      data: { text: textOutput, input: finalPrompt },
    };
  } catch (error) {
    rootLogger.error({
      msg: "generateTagTreeByLLM error",
      requestId,
      teamId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "生成标签树失败",
    };
  }
}
