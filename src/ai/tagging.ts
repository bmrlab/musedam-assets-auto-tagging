import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, Tag, TaggingQueueItem } from "@/prisma/client";
import { InputJsonObject, InputJsonValue } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { generateObject } from "ai";
import { z } from "zod";

interface TagWithChildren extends Tag {
  children?: TagWithChildren[];
}

export interface TagPrediction {
  tagPath: string[];
  confidence: number;
  source: string[];
}

const TagPredictionSchema = z.object({
  predictions: z
    .array(
      z.object({
        tagPath: z.array(z.string()).min(1).max(3),
        confidence: z.number().min(0).max(1),
        source: z.array(z.string()).min(1),
      }),
    )
    .min(1),
});

/**
 * 使用AI预测资产的最适合标签
 * @param asset 资产对象
 * @param availableTags 可用的标签列表（包含层级关系）
 * @returns 预测结果数组，包含标签路径和置信度
 */
async function predictAssetTags(
  asset: AssetObject,
  availableTags: TagWithChildren[],
): Promise<TagPrediction[]> {
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

  const prompt = `你是一个专业的数字资产管理AI助手，需要为资产文件预测最合适的标签。

资产信息：
- 文件名：${asset.name}
- 文件路径：${asset.materializedPath}
- 描述：${asset.description || "无描述"}
- 现有标签：${existingTags.length > 0 ? existingTags.join(", ") : "无"}
- 其他内容：${Object.keys(contentData).length > 0 ? JSON.stringify(contentData) : "无"}

可用标签体系：
${tagStructureText}

请根据以上信息，预测5个最适合的标签，每个预测包含：
1. 标签的完整路径（从一级到最终级别）
2. 置信度（0-1之间的数值）
3. 预测来源（基于哪些资产信息得出的预测）

注意事项：
- 如果预测二级标签，路径应包含：[一级标签, 二级标签]
- 如果预测三级标签，路径应包含：[一级标签, 二级标签, 三级标签]
- 置信度需要基于文件名、路径、描述等信息的匹配程度
- 考虑文件扩展名、路径语义、描述内容等多个维度
- 优先推荐更具体的标签（三级 > 二级 > 一级）
- 确保标签路径在给定的标签体系中存在
- 预测来源应明确指出是基于文件名、文件路径、描述、扩展名中的哪些信息

可用的来源类型：
- "文件名" - 基于文件名分析
- "文件路径" - 基于文件夹路径分析
- "文件描述" - 基于描述内容分析
- "文件扩展名" - 基于文件类型分析
- "现有标签" - 基于已有标签推测

示例输出格式：
{
  "predictions": [
    {
      "tagPath": ["产品类别", "电子产品", "手机设备"],
      "confidence": 0.95,
      "source": ["文件名", "文件路径"]
    },
    {
      "tagPath": ["媒体类型", "图片素材", "产品图片"],
      "confidence": 0.88,
      "source": ["文件扩展名", "文件路径"]
    }
  ]
}
}`;

  try {
    const result = await generateObject({
      model: llm("gpt-5-mini"),
      schema: TagPredictionSchema,
      prompt,
    });

    return result.object.predictions.map((pred) => ({
      tagPath: pred.tagPath,
      confidence: pred.confidence,
      source: pred.source,
    }));
  } catch (error) {
    console.error("AI标签预测失败:", error);
    throw new Error("AI标签预测失败");
  }
}

/**
 * 构建标签结构的文本描述
 */
function buildTagStructureText(tags: TagWithChildren[]): string {
  const level1Tags = tags.filter((tag) => tag.level === 1);

  let structureText = "";

  for (const level1Tag of level1Tags) {
    structureText += `\n一级标签: ${level1Tag.name}\n`;

    const level2Tags = tags.filter((tag) => tag.level === 2 && tag.parentId === level1Tag.id);

    for (const level2Tag of level2Tags) {
      structureText += `  └─ 二级标签: ${level2Tag.name}\n`;

      const level3Tags = tags.filter((tag) => tag.level === 3 && tag.parentId === level2Tag.id);

      for (const level3Tag of level3Tags) {
        structureText += `      └─ 三级标签: ${level3Tag.name}\n`;
      }
    }
  }

  return structureText;
}

export async function enqueueTaggingTask({
  assetObject,
}: {
  assetObject: AssetObject;
}): Promise<TaggingQueueItem> {
  const teamId = assetObject.teamId;

  // 获取团队的所有标签
  const tags = await prisma.tag
    .findMany({
      where: { teamId },
      orderBy: [{ level: "asc" }, { name: "asc" }],
      include: {
        parent: true,
        children: {
          orderBy: { name: "asc" },
          include: {
            children: {
              orderBy: { name: "asc" },
            },
          },
        },
      },
    })
    .then((tags) => tags as TagWithChildren[]);

  const taggingQueueItem = await prisma.taggingQueueItem.create({
    data: {
      teamId: teamId,
      assetObjectId: assetObject.id,
      status: "processing",
      startsAt: new Date(),
    },
  });

  waitUntil(
    (async () => {
      try {
        const predictions = await predictAssetTags(assetObject, tags);
        await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "completed",
            endsAt: new Date(),
            result: { predictions: predictions as unknown as InputJsonObject },
          },
        });
      } catch (error) {
        await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "failed",
            endsAt: new Date(),
            result: { error: error as InputJsonValue },
          },
        });
      }
    })(),
  );

  return taggingQueueItem;
}
