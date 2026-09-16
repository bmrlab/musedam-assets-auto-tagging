import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import { rootLogger } from "@/lib/logging";
import { AssetTagExtra, TagWithChildren } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { generateObject } from "ai";
import z from "zod";
import {
  applyContentOnlyRejection,
  applyEvidencePoliciesToTree,
  collectTagsMissingEvidencePolicy,
  EvidencePolicy,
  isContentOnlySupport,
} from "./evidence-policy";
import { TagWithScore } from "./types";
import { fetchTagsTree } from "./utils";

const logger = rootLogger.child({ module: "evidence-policy" });

function getEvidencePolicyModel(): LLMModelName {
  return (process.env.TAGGING_EVIDENCE_POLICY_MODEL?.trim() ||
    process.env.TAGGING_PREDICT_MODEL?.trim() ||
    "gpt-5-mini") as LLMModelName;
}

const evidencePolicyResponseSchema = z.object({
  tags: z.array(
    z.object({
      id: z.number(),
      policy: z.enum(["content", "literal"]),
    }),
  ),
});

const EVIDENCE_POLICY_SYSTEM_PROMPT = `你是数字资产管理（DAM）系统的标签体系分析专家。系统会用 AI 给素材自动打标签，你的任务是判断每个标签允许什么样的证据来支撑一次预测。

两种策略：
- content：标签描述的是素材画面/内容本身呈现的东西。例如：品类（面霜、洁面）、素材类型（海报、主图、短视频）、场景（户外、办公室）、风格（极简、复古）、构图、色调、人物数量、情绪氛围。看图或看内容描述就能判断。
- literal：标签描述的是素材之外的业务安排或计划性事实。例如：投放渠道/平台（小红书、抖音、天猫、线下门店）、目标市场/地区（欧洲、东南亚、华东）、目标人群（Z 世代、母婴人群）、所属活动/campaign（双十一、618、周年庆）、上线档期/季节（春季、Q3）、项目/品牌线/客户名、内部编号。这些信息画面通常回答不了，模型很容易凭"风格像小红书""氛围像春节"这类间接印象去猜，所以必须要求文件名、路径、描述或画面上明确可见的文字/标识里真实出现对应内容。

判断规则：
1. 看标签本质上是"内容本身"还是"内容之外的安排"，不要只看分类名里有没有"渠道"这类字眼；父级分类名是重要线索（例如父级叫"投放平台""Market""Campaign"，其下的叶子都应为 literal）。
2. 一级/二级分类节点本身也要给策略，通常与其子节点一致。
3. 拿不准时选 literal（宁可漏标，不要凭氛围乱贴业务标签）。
4. 只输出 JSON，对给出的每个 id 都返回一条，不要遗漏、不要新增 id。`;

/**
 * 为标签树中缺少显式证据策略的节点自动判定策略并写回数据库。
 * 一个团队通常只会跑一次，之后只对新增标签增量补。失败时不抛错：本次预测按旧启发式兜底。
 */
export async function ensureEvidencePolicies({
  teamId,
  tagsTree,
}: {
  teamId: number;
  tagsTree: TagWithChildren[];
}): Promise<{ classified: number }> {
  const missing = collectTagsMissingEvidencePolicy(tagsTree);
  if (missing.length === 0) return { classified: 0 };

  const modelName = getEvidencePolicyModel();
  const input = missing
    .map((node) => `- id ${node.id}: ${node.tagPath.join(" / ")}`)
    .join("\n");

  let policyById: Map<number, EvidencePolicy>;
  try {
    const result = await generateObject({
      model: llm(modelName),
      schemaName: "TagEvidencePolicies",
      schema: evidencePolicyResponseSchema,
      system: EVIDENCE_POLICY_SYSTEM_PROMPT,
      prompt: `以下是需要判定的标签（路径从一级到该标签自身）：\n${input}\n\n返回 {"tags":[{"id":<id>,"policy":"content"|"literal"},...]}。`,
      temperature: 0,
    });
    const validIds = new Set(missing.map((node) => node.id));
    policyById = new Map(
      result.object.tags
        .filter((item) => validIds.has(item.id))
        .map((item) => [item.id, item.policy] as const),
    );
  } catch (error) {
    logger.warn({
      msg: "ensureEvidencePolicies: LLM classification failed, falling back to legacy heuristic",
      teamId,
      missingCount: missing.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return { classified: 0 };
  }

  // 模型漏掉的 id 按保守策略处理，避免每次预测都重复分类。
  for (const node of missing) {
    if (!policyById.has(node.id)) policyById.set(node.id, "literal");
  }

  applyEvidencePoliciesToTree(tagsTree, policyById, "auto");

  const persisted = await Promise.allSettled(
    missing.map(async (node) => {
      const tag = await prisma.assetTag.findUnique({
        where: { id: node.id },
        select: { id: true, teamId: true, extra: true },
      });
      if (!tag || tag.teamId !== teamId) return;
      const extra = ((tag.extra as AssetTagExtra | null) ?? {}) as AssetTagExtra;
      // 并发批次可能已经写过，尊重已有值
      if (extra.evidencePolicy) return;
      await prisma.assetTag.update({
        where: { id: node.id },
        data: {
          extra: {
            ...extra,
            evidencePolicy: policyById.get(node.id)!,
            evidencePolicySource: "auto",
          },
        },
      });
    }),
  );
  const failed = persisted.filter((item) => item.status === "rejected").length;

  logger.info({
    msg: "ensureEvidencePolicies: classified tags",
    teamId,
    model: modelName,
    classified: policyById.size,
    literal: [...policyById.values()].filter((policy) => policy === "literal").length,
    persistFailed: failed,
  });

  return { classified: policyById.size };
}

/** 打标预测专用：拉取标签树并保证每个节点都有证据策略。 */
export async function fetchTagsTreeForTagging({ teamId }: { teamId: number }) {
  const tagsTree = await fetchTagsTree({ teamId });
  if (tagsTree.length > 0) {
    await ensureEvidencePolicies({ teamId, tagsTree });
  }
  return tagsTree;
}

/**
 * 审核环节拒绝了某个 AI 推荐标签时调用：如果这条推荐只有 contentAnalysis 一个来源在支撑，
 * 说明模型仅凭画面印象就打上了标签；累计到阈值后自动把该标签的证据策略降级为 literal。
 * 失败是非致命的：单条失败不影响其他条目，也不阻断审核主流程。
 */
export async function recordContentOnlyRejectionFeedbackBatch(
  items: Array<{
    teamId: number;
    leafTagId: number;
    confidenceBySources: TagWithScore["confidenceBySources"] | undefined;
  }>,
): Promise<{ downgradedTagIds: number[] }> {
  const downgradedTagIds: number[] = [];
  for (const item of items) {
    if (!isContentOnlySupport(item.confidenceBySources)) continue;
    try {
      const tag = await prisma.assetTag.findUnique({
        where: { id: item.leafTagId },
        select: { id: true, teamId: true, extra: true },
      });
      if (!tag || tag.teamId !== item.teamId) continue;
      const { extra, downgraded } = applyContentOnlyRejection(tag.extra as AssetTagExtra | null);
      await prisma.assetTag.update({ where: { id: tag.id }, data: { extra } });
      if (downgraded) {
        downgradedTagIds.push(tag.id);
        logger.info({
          msg: "evidence policy downgraded to literal by review feedback",
          teamId: item.teamId,
          tagId: tag.id,
        });
      }
    } catch (error) {
      logger.warn({
        msg: "recordContentOnlyRejectionFeedback failed",
        teamId: item.teamId,
        tagId: item.leafTagId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { downgradedTagIds };
}
