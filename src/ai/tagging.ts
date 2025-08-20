import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, TaggingQueueItem, TagWithChildren } from "@/prisma/client";
import { InputJsonObject, InputJsonValue } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { generateObject, UserModelMessage } from "ai";
import { SourceBasedTagPredictions, tagPredictionSchema } from "./types";

/**
 * 使用AI预测内容素材的最适合标签
 * @param asset 内容素材对象
 * @param availableTags 可用的标签列表（包含层级关系）
 * @returns 预测结果数组，包含标签路径和置信度
 */
export async function predictAssetTags(
  asset: AssetObject,
  availableTags: TagWithChildren[],
): Promise<SourceBasedTagPredictions> {
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

  const systemPrompt = `# 角色定义
你是一个专业的数字内容素材标签分析专家，擅长从不同维度分析内容素材信息并预测合适的分类标签。

# 分析策略
按照以下步骤进行系统化分析：

## Step 1: 信息源评估
首先评估三个信息源的有效性：
- **filename**: 文件名称和描述信息
- **filepath**: 文件路径结构信息
- **content**: 内容分析和元数据信息

如果某个信息源无效（空值、随机字符、无意义文本），则跳过该源的分析。

## Step 2: 逐源分析流程
对每个有效的信息源，按以下步骤进行分析：

### 2.1 一级分类识别
- 基于当前信息源的语义特征，识别最匹配的1-2个一级标签
- 分析文本中的关键词、主题概念、类型特征等通用信息
- 评估匹配的置信度（0-1）
- 如果置信度低于0.3，跳过该信息源

### 2.2 二级分类细化
- 在确定的一级标签基础上，寻找最适合的二级标签
- 深入分析具体子类别、功能属性、应用场景等细节信息
- 评估二级标签的置信度
- 如果没有合适的二级标签，停留在一级

### 2.3 三级分类精化
- 在确定的二级标签基础上，寻找最精确的三级标签
- 分析更细致的分类维度和具体特征属性
- 评估三级标签的置信度
- 优先推荐三级标签，但不强制

## Step 3: 质量控制
- 每个信息源最多输出3个标签预测
- 确保所有标签路径在给定标签体系中存在
- 置信度反映真实匹配程度，避免过度自信

# 输出格式
每个预测必须包含三个字段：
1. **tagPath**: 标签路径数组（从一级到最终级别）
2. **confidence**: 置信度数值（0-1之间）
3. **leafTagId**: 最末级标签的数据库ID（关键验证字段）

\`\`\`json
{
  "filename": [
    {
      "tagPath": ["媒体类型", "图片", "产品图"],
      "confidence": 0.85,
      "leafTagId": 3
    },
    {
      "tagPath": ["用途", "商业"],
      "confidence": 0.72,
      "leafTagId": 5
    }
  ],
  "filepath": [
    {
      "tagPath": ["项目分类", "设计素材", "UI组件"],
      "confidence": 0.88,
      "leafTagId": 15
    },
    {
      "tagPath": ["颜色", "蓝色"],
      "confidence": 0.45,
      "leafTagId": 23
    }
  ],
  "content": [
    {
      "tagPath": ["风格", "简约"],
      "confidence": 0.63,
      "leafTagId": 18
    }
  ]
}
\`\`\`

# 重要提醒
- 信息源标识固定为: filename, filepath, content
- 每个信息源独立分析，互不影响
- 先确定一级分类，再逐步细化
- 无有效信息的源返回空数组[]

## 关键：leafTagId 字段说明
- **必须输出**: 每个预测都必须包含 leafTagId 字段
- **取值规则**: 使用标签路径中最后一级标签的 id 值
- **验证机制**: 此 ID 用于验证预测准确性，即使 tagPath 文本有误，系统也能通过 ID 进行纠错
- **示例**: 如果预测路径为 ["媒体类型", "图片", "产品图"]，则 leafTagId 应为 "产品图" 这个三级标签的 id`;

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

## filename信息源
文件名：${asset.name}
文件描述：${asset.description || "无"}

## filepath信息源
文件路径：${asset.materializedPath}

## content信息源
内容分析：${Object.keys(contentData).length > 0 ? JSON.stringify(contentData, null, 2) : "无有效内容数据"}

---

请严格按照Step by Step流程进行分析：

1. **信息源评估**：评估上述三个信息源(filename, filepath, content)的有效性
2. **逐源分析**：对每个有效信息源，依次进行：
   - 识别最匹配的1-2个一级标签
   - 在确定一级标签后，细化到二级标签
   - 在确定二级标签后，精化到三级标签
3. **输出结果**：按指定格式输出，每个信息源最多3个标签预测

记住：先确定一级分类，再逐步细化到二三级。无效信息源返回空数组。`,
    },
  ];

  try {
    const result = await generateObject({
      // model: llm("claude-sonnet-4"),
      model: llm("gpt-5-nano"),
      // providerOptions: {
      //   azure: { promptCacheKey: `musedam-t-${asset.teamId}` },
      // },
      schema: tagPredictionSchema,
      system: systemPrompt,
      messages,
    });

    // console.log(result.object);
    // console.log(result.usage, result.providerMetadata);

    return result.object;
  } catch (error) {
    console.error("AI标签预测失败:", error);
    throw new Error("AI标签预测失败");
  }
}

/**
 * 构建标签结构的文本描述
 */
export function buildTagStructureText(tags: TagWithChildren[]): string {
  let structureText = "";
  for (const level1Tag of tags) {
    structureText += `\Level 1 (id: ${level1Tag.id}): ${level1Tag.name}\n`;
    for (const level2Tag of level1Tag.children ?? []) {
      structureText += `  └─ Level 2 (id: ${level2Tag.id}): ${level2Tag.name}\n`;
      for (const level3Tag of level2Tag.children ?? []) {
        structureText += `      └─ Level 3 (id: ${level3Tag.id}): ${level3Tag.name}\n`;
      }
    }
  }
  return structureText;
}

export async function fetchTagsTree({ teamId }: { teamId: number }) {
  const tags = await prisma.tag
    .findMany({
      where: {
        teamId,
        parentId: { equals: null },
      },
      orderBy: [{ id: "asc" }],
      select: {
        id: true,
        name: true,
        children: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            name: true,
            children: {
              select: {
                id: true,
                name: true,
              },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    })
    .then((tags) => tags as TagWithChildren[]);
  return tags;
}

export async function enqueueTaggingTask({
  assetObject,
}: {
  assetObject: AssetObject;
}): Promise<TaggingQueueItem> {
  const teamId = assetObject.teamId;

  // 获取团队的所有标签
  const tagsTree = await fetchTagsTree({ teamId });

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
        const predictions = await predictAssetTags(assetObject, tagsTree);
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
