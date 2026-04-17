import "server-only";

import { llm } from "@/ai/provider";
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
    });

    const config = getLanguageConfig(lang);

    const structuredPrompt = `${finalPrompt}

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

    const result = await generateObject({
      model: llm("claude-sonnet-4"),
      schema: tagTreeSchema,
      schemaName: config.schemaName,
      schemaDescription: config.schemaDescription,
      prompt: structuredPrompt,
    });

    const textOutput = convertStructuredToText(result.object);

    rootLogger.info({
      msg: "generateTagTreeByLLM: 生成成功",
      requestId,
      teamId,
      structuredData: result.object,
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
