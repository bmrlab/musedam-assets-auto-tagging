import "server-only";

import { llm } from "@/ai/provider";
import { AssetObject, TaggingQueueItem, TagWithChildren } from "@/prisma/client";
import { InputJsonObject, InputJsonValue } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { waitUntil } from "@vercel/functions";
import { streamObject, UserModelMessage } from "ai";
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
- **basicInfo**: 文件名称和描述信息
- **materializedPath**: 文件路径结构信息
- **contentAnalysis**: 内容分析和元数据信息

如果某个信息源无效（空值、随机字符、无意义文本），则跳过该源的分析。

## Step 2: 整体语义匹配
对每个有效的信息源，进行整体语义匹配：

### 2.1 完整路径识别
- 将当前信息源与所有可用标签的完整路径进行语义匹配
- 寻找最符合信息源语义的完整标签概念（可以是1级、2级或3级标签）
- 不要被层级结构限制，直接匹配最贴切的完整语义概念

### 2.2 优先级原则
- **语义匹配度优先**：优先选择语义最匹配的标签，无论层级
- **具体性优先**：在语义匹配度相当的情况下，优先选择更具体的标签（3级 > 2级 > 1级）
- **置信度评估**：基于信息源与完整标签路径的匹配程度评估置信度

## Step 3: 质量控制与输出策略
- 整体输出控制：所有来源合计输出4-6个标签预测（除非信息严重不足）
- 来源分配建议：每个有效信息源输出1-3个标签，根据信息质量灵活调整
- 确保所有标签路径在给定标签体系中存在
- 严格按照置信度评分标准进行评分

# 置信度评分标准
置信度必须基于以下客观标准进行评估，确保评分一致性：

## 🔵 精准区间（0.80-1.00）- 直接匹配
**评分依据**：
- **直接匹配**：信息源中包含与标签完全一致或高度相似的关键词
- **上下文明确**：信息源提供充分的上下文支持该分类
- **无歧义性**：该分类是唯一合理的解释，无其他竞争标签
- **示例场景**：
  - 文件名"brand_logo.svg"直接匹配到["品牌素材", "Logo"]
  - 路径"/marketing/poster/"直接匹配到["营销素材", "海报"]
  - 描述"产品展示图"直接匹配到["媒体类型", "图片", "产品图"]

## 🟢 平衡区间（0.70-0.79）- 合理推断
**评分依据**：
- **间接匹配**：通过语义分析或常识推断得出的合理分类
- **较强证据**：有较好的支持证据，推理过程合理
- **轻微歧义**：可能有其他标签也较合适，但当前最优
- **示例场景**：
  - 文件名"banner_blue.jpg"匹配到["颜色", "蓝色"]（从颜色关键词推断）
  - 路径包含"design"匹配到["项目分类", "设计素材"]（从用途推断）
  - 文件名"promo_video.mp4"匹配到["媒体类型", "视频"]（从格式推断）

## 🟡 宽泛区间（0.60-0.69）- 弱匹配但保留
**评分依据**：
- **弱关联**：基于间接线索的推测，但仍有一定合理性
- **有限证据**：证据不够充分，但符合常理推断
- **轻度歧义**：存在其他可能的标签选择，但当前标签仍可接受
- **示例场景**：
  - 路径包含"temp"弱匹配到["状态", "临时"]（推断相对模糊）
  - 扩展名".psd"弱匹配到["文件类型", "设计源文件"]（间接推断）
  - 文件名"image_v2"弱匹配到["版本", "修订版"]（推断不够确定）

## 🔴 超低区间（0.60以下）- 显示为红色
**评分依据**：
- **几乎无关联**：基于非常薄弱或错误的线索
- **高度歧义**：存在多个同样或更合理的标签选择
- **信息严重不足**：信息源无法提供有效分类依据
- **显示方式**：前端显示为红色标识，提醒用户关注

## 评分原则
1. **保守原则**：宁可低估也不过度自信
2. **一致性原则**：相似情况应给出相似置信度
3. **客观原则**：基于信息匹配程度，不受标签重要性影响
4. **证据原则**：置信度必须有明确的匹配证据支撑

# 输出格式
返回一个数组，每个元素包含：
1. **source**: 信息源标识（"basicInfo" | "materializedPath" | "contentAnalysis"）
2. **tags**: 该信息源的标签预测数组，每个预测包含：
   - **confidence**: 置信度数值（0-1之间）
   - **leafTagId**: 最末级标签的数据库ID（关键验证字段）
   - **tagPath**: 标签路径数组（从一级到最终级别）

\`\`\`json
[
  {
    "source": "basicInfo",
    "tags": [
      {
        "confidence": 0.85,
        "leafTagId": 3,
        "tagPath": ["媒体类型", "图片", "产品图"]
      },
      {
        "confidence": 0.72,
        "leafTagId": 5,
        "tagPath": ["用途", "商业"]
      }
    ]
  },
  {
    "source": "materializedPath",
    "tags": [
      {
        "confidence": 0.88,
        "leafTagId": 15,
        "tagPath": ["项目分类", "设计素材", "UI组件"]
      }
    ]
  },
  {
    "source": "contentAnalysis",
    "tags": [
      {
        "confidence": 0.63,
        "leafTagId": 18,
        "tagPath": ["风格", "简约"]
      }
    ]
  }
]
\`\`\`

# 重要提醒
- 信息源标识固定为: basicInfo, materializedPath, contentAnalysis
- 每个信息源独立分析，互不影响
- 先确定一级分类，再逐步细化
- 无有效信息的源返回空tags数组[]

## 关键：leafTagId 字段说明
- **必须输出**: 每个预测都必须包含 leafTagId 字段
- **取值规则**: 使用标签路径中最后一级标签的 id 值
- **验证机制**: 此 ID 用于验证预测准确性，即使 tagPath 文本有误，系统也能通过 ID 进行纠错
- **示例**: 如果预测路径为 ["媒体类型", "图片", "产品图"]，则 leafTagId 应为 "产品图" 这个三级标签的 id

## 置信度评分要求
- **严格执行**: 必须严格按照上述置信度评分标准进行评估
- **保持一致**: 相同质量的匹配必须给出相同区间的置信度
- **最低门槛**: 只输出置信度≥0.5的预测，低于此值的直接丢弃
- **客观评分**: 置信度反映信息匹配程度，不受标签类型或重要性影响
- **证据支撑**: 每个置信度评分都必须有明确的匹配证据`;

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

---

请严格按照Step by Step流程进行分析：

1. **信息源评估**：评估上述三个信息源(basicInfo, materializedPath, contentAnalysis)的有效性
2. **整体语义匹配**：对每个有效信息源，进行完整的语义匹配：
   - 将信息源与所有可用标签的完整路径进行匹配
   - 直接寻找最符合语义的完整标签概念（1级、2级或3级均可）
   - 优先选择语义匹配度最高的标签，在匹配度相当时选择更具体的标签
3. **输出结果**：按指定格式输出数组结构，每个信息源最多3个标签预测

记住：不要被层级结构限制，直接匹配最贴切的完整语义概念。无效信息源返回空tags数组。

**重要**：整体目标是输出4-6个标签预测，合理分配到各信息源。多个来源预测同一标签时，该标签的整体置信度会提升，所以单个来源的门槛可以适当宽松。`,
    },
  ];

  const streamObjectPromise = new Promise<SourceBasedTagPredictions>(async (resolve, reject) => {
    try {
      const { partialObjectStream } = streamObject({
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
        system: systemPrompt,
        messages,
        onFinish: (result) => {
          // console.log(result.object);
          // console.log(result.usage, result.providerMetadata);
          if (!result.object) {
            reject(new Error("AI标签预测失败, result.object is undefined"));
          } else {
            resolve(result.object);
          }
        },
      });
      for await (const partialObject of partialObjectStream) {
        // console.log(partialObject);
      }
    } catch (error) {
      console.error("AI标签预测失败:", error);
      reject(new Error("AI标签预测失败"));
    }
  });

  return await streamObjectPromise;
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
