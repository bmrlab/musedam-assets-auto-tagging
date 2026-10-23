import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import { Locale, getLanguageConfig } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import type { ServerActionResult } from "@/lib/serverAction";
import { generateObject } from "ai";
import { z } from "zod";

const level4TagSchema = z.object({
  name: z.string().describe("四级标签名称"),
});

const level3TagSchema = z.object({
  name: z.string().describe("三级标签名称"),
  children: z.array(level4TagSchema).optional().describe("四级标签列表（可选）"),
});

const level2TagSchema = z.object({
  name: z.string().describe("二级标签名称"),
  children: z.array(level3TagSchema).optional().describe("三级标签列表"),
});

const tagTreeSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string().describe("一级标签名称"),
      children: z.array(level2TagSchema).optional().describe("二级标签列表"),
    }),
  ),
});

/**
 * 结构化标签树 -> 批量创建文本格式：
 * `#` 一级，`##` 二级，`###` 三级，普通文本为最近一个标题的子标签（最末级）。
 * - 同一个二级下的三级都没有子标签时，三级直接输出为普通文本（与旧的三层格式一致）；
 * - 只要有一个三级带四级子标签，该二级下的三级全部用 `###` 输出（保持原顺序），
 *   四级以普通文本跟在对应 `###` 之后。
 */
function convertStructuredToText(data: z.infer<typeof tagTreeSchema>): string {
  const lines: string[] = [];

  for (const level1 of data.tags) {
    lines.push(`# ${level1.name}`);

    for (const level2 of level1.children ?? []) {
      lines.push(`## ${level2.name}`);

      const level3List = level2.children ?? [];
      const hasLevel4 = level3List.some((level3) => !!level3.children?.length);
      for (const level3 of level3List) {
        if (!hasLevel4) {
          lines.push(level3.name);
          continue;
        }
        lines.push(`### ${level3.name}`);
        for (const level4 of level3.children ?? []) {
          lines.push(level4.name);
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
            {
              "name": "${config.level3Label1}",
              "children": [{ "name": "${config.level4Label}" }]
            },
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
