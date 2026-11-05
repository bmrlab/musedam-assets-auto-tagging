import "server-only";

import { resolveModelChain, runWithModelFallback } from "@/ai/model-fallback";
import { llm, LLMModelName } from "@/ai/provider";
import { rootLogger } from "@/lib/logging";
import { LLM_TIMEOUT_MS } from "@/lib/tagging/external-timeouts";
import { AssetTagExtra, Prisma, TagWithChildren } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { generateObject } from "ai";
import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import z from "zod";
import {
  applyContentOnlyRejection,
  collectTagsMissingEvidencePolicy,
  getExplicitEvidencePolicy,
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
      /** 仅对有子标签的分类节点输出：其直接子标签是否同级互斥 */
      siblingsExclusive: z.boolean().optional(),
    }),
  ),
});

const EVIDENCE_POLICY_SYSTEM_PROMPT = `你是数字资产管理（DAM）系统的标签体系分析专家。系统会用 AI 给素材自动打标签，你的任务是判断每个标签允许什么样的证据来支撑一次预测。

两种策略：
- content：标签描述的是素材画面/内容本身呈现的东西。例如：品类（面霜、洁面）、素材类型（海报、主图、短视频）、场景（户外、办公室）、风格（极简、复古）、构图、色调、人物数量、情绪氛围。看图或看内容描述就能判断。
- literal：标签描述的是素材之外的业务安排或计划性事实。例如：投放渠道/平台（小红书、抖音、天猫、线下门店）、目标市场/地区（欧洲、东南亚、华东）、目标人群（Z 世代、母婴人群）、所属活动/campaign（双十一、618、周年庆）、上线档期/季节（春季、Q3）、项目/品牌线/客户名、内部编号。这些信息画面通常回答不了，模型很容易凭"风格像小红书""氛围像春节"这类间接印象去猜，所以必须要求文件名、路径、描述或画面上明确可见的文字/标识里真实出现对应内容。

判断规则：
1. 看标签本质上是"内容本身"还是"内容之外的安排"，不要只看分类名里有没有"渠道"这类字眼；父级分类名是重要线索（例如父级叫"投放平台""Market""Campaign"，其下的叶子都应为 literal）。
2. 所有非叶子分类节点本身也要给策略，通常与其子节点一致。
3. 拿不准时选 literal（宁可漏标，不要凭氛围乱贴业务标签）。

同级互斥（siblingsExclusive），只对标注了"有子标签"的分类节点输出：
- true：其直接子标签是同一属性维度的不同取值，一个素材通常只能归属其中一个。例如 产品品类>护肤 下的 洁面/面霜/喷雾、节庆节点 下的 七夕/新年/中秋、媒体类型 下的 图片/视频、人数 下的 单人/双人/多人。
- false：子标签彼此独立、可以同时成立。例如 风格 下的 极简/复古、投放渠道 下的 小红书/抖音、内容元素 下的 人物/产品/文字。
- 拿不准时选 false（不要误伤可以共存的标签）。

4. 只输出 JSON，对给出的每个 id 都返回一条，不要遗漏、不要新增 id；没有子标签的节点不要输出 siblingsExclusive。`;

/**
 * 为标签树中缺少显式证据策略的节点自动判定策略并写回数据库。
 * 一个团队通常只会跑一次，之后只对新增标签增量补。失败时不抛错：本次预测按旧启发式兜底。
 */
export const EVIDENCE_POLICY_BATCH_SIZE = 1000;
export const EVIDENCE_POLICY_BATCH_CHAR_LIMIT = 32_000;
const LEASE_KEY = "tagging-evidence-policy-lease";
const LEASE_MS = 120_000;
const initializationLimit = pLimit(2);
const policyWriteLimit = pLimit(5);
const inFlight = new Map<number, Promise<Map<number, AssetTagExtra>>>();
const retryAfter = new Map<number, number>();

function applyMissingPolicies(
  tagsTree: TagWithChildren[],
  extras: ReadonlyMap<number, AssetTagExtra>,
) {
  for (const tag of tagsTree) {
    const saved = extras.get(tag.id);
    if (saved) {
      const current = (tag.extra ?? {}) as AssetTagExtra;
      tag.extra = {
        ...current,
        ...(saved.configurationSource === "import"
          ? { configurationSource: "import" as const }
          : {}),
        ...(!getExplicitEvidencePolicy(current)
          ? {
              evidencePolicy: saved.evidencePolicy,
              evidencePolicySource: saved.evidencePolicySource,
            }
          : {}),
        ...(typeof current.siblingsExclusive !== "boolean" &&
        typeof saved.siblingsExclusive === "boolean"
          ? { siblingsExclusive: saved.siblingsExclusive }
          : {}),
      };
    }
    applyMissingPolicies(tag.children ?? [], extras);
  }
}

export function buildEvidencePolicyBatches(
  nodes: ReturnType<typeof collectTagsMissingEvidencePolicy>,
) {
  const batches: (typeof nodes)[] = [];
  let batch: typeof nodes = [];
  let size = 0;
  for (const node of nodes) {
    const length = policyLine(node).length + 1;
    if (
      batch.length &&
      (batch.length >= EVIDENCE_POLICY_BATCH_SIZE ||
        size + length > EVIDENCE_POLICY_BATCH_CHAR_LIMIT)
    ) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(node);
    size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
function policyLine(node: ReturnType<typeof collectTagsMissingEvidencePolicy>[number]) {
  return `- id ${node.id}: ${node.tagPath.join(" / ")}${node.hasChildren ? "（有子标签，需判断同级互斥）" : ""}`;
}

async function initializePolicies(
  teamId: number,
  tagsTree: TagWithChildren[],
): Promise<Map<number, AssetTagExtra>> {
  const owner = randomUUID();
  const value = JSON.stringify({ owner, expiresAt: Date.now() + LEASE_MS });
  // An atomic expiring lease across worker processes; no schema change or long
  // database transaction spanning a model request is required.
  const lease = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "TeamConfig" ("teamId", "key", "value", "createdAt", "updatedAt")
    VALUES (${teamId}, ${LEASE_KEY}, ${value}::jsonb, now(), now())
    ON CONFLICT ("teamId", "key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE COALESCE(("TeamConfig"."value"->>'expiresAt')::bigint, 0) < ${Date.now()}
    RETURNING "id"`;
  const saved = new Map<number, AssetTagExtra>();
  if (lease.length === 0) return saved;
  const ownedLease = { teamId, key: LEASE_KEY, value: { path: ["owner"], equals: owner } };
  let incomplete = false;
  const leaseAbort = new AbortController();
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      const renewed = await prisma.teamConfig.updateMany({
        where: ownedLease,
        data: { value: { owner, expiresAt: Date.now() + LEASE_MS } },
      });
      if (!renewed.count) {
        incomplete = true;
        leaseAbort.abort();
      }
    } catch {
      incomplete = true;
      leaseAbort.abort();
    } finally {
      renewing = false;
    }
  }, 30_000);
  heartbeat.unref?.();
  try {
    const batches = buildEvidencePolicyBatches(collectTagsMissingEvidencePolicy(tagsTree));
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      if (leaseAbort.signal.aborted) break;
      const renewed = await prisma.teamConfig.updateMany({
        where: ownedLease,
        data: { value: { owner, expiresAt: Date.now() + LEASE_MS } },
      });
      if (!renewed.count) break;
      try {
        const rows = await prisma.assetTag.findMany({
          where: { teamId, id: { in: batch.map((node) => node.id) } },
          select: { id: true, extra: true },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const pending = batch.filter((node) => {
          const row = byId.get(node.id);
          if (!row) return false;
          const extra = (row.extra ?? {}) as AssetTagExtra;
          if (extra.configurationSource === "import") {
            saved.set(node.id, extra);
            return false;
          }
          if (
            getExplicitEvidencePolicy(extra) &&
            (!node.hasChildren || typeof extra.siblingsExclusive === "boolean")
          ) {
            saved.set(node.id, extra);
            return false;
          }
          return true;
        });
        if (!pending.length) continue;
        const result = await runWithModelFallback(
          resolveModelChain(
            getEvidencePolicyModel(),
            process.env.TAGGING_PREDICT_FALLBACK_MODELS,
            "gpt-5.4-mini",
          ),
          (modelName) =>
            generateObject({
              model: llm(modelName),
              schemaName: "TagEvidencePolicies",
              schema: evidencePolicyResponseSchema,
              system: EVIDENCE_POLICY_SYSTEM_PROMPT,
              prompt: `以下是需要判定的标签：\n${pending.map(policyLine).join("\n")}\n返回 {"tags":[{"id":<id>,"policy":"content"|"literal","siblingsExclusive":<仅有子标签时 true|false>}]}`,
              temperature: 0,
              maxRetries: 1,
              abortSignal: AbortSignal.any([
                leaseAbort.signal,
                AbortSignal.timeout(LLM_TIMEOUT_MS),
              ]),
            }),
        );
        const classifications = new Map(result.object.tags.map((item) => [item.id, item]));
        if (pending.some((node) => !classifications.has(node.id))) incomplete = true;
        await Promise.all(
          pending.map((node) =>
            policyWriteLimit(async () => {
              if (leaseAbort.signal.aborted) return;
              const classification = classifications.get(node.id);
              const row = byId.get(node.id)!;
              if (!classification) return; // Omitted IDs remain missing and can be retried.
              const current = (row.extra ?? {}) as AssetTagExtra;
              const next: AssetTagExtra = {
                ...current,
                ...(!getExplicitEvidencePolicy(current)
                  ? { evidencePolicy: classification.policy, evidencePolicySource: "auto" as const }
                  : {}),
                ...(node.hasChildren && typeof current.siblingsExclusive !== "boolean"
                  ? { siblingsExclusive: classification.siblingsExclusive ?? false }
                  : {}),
              };
              try {
                // Compare-and-set prevents an administrator's concurrent edit from
                // being overwritten by the model's older snapshot.
                const updated = await prisma.assetTag.updateMany({
                  where: {
                    id: row.id,
                    teamId,
                    extra: { equals: row.extra === null ? Prisma.JsonNull : row.extra },
                  },
                  data: { extra: next },
                });
                if (updated.count) saved.set(row.id, next);
                else incomplete = true;
              } catch (error) {
                incomplete = true;
                logger.warn({
                  msg: "Evidence policy write failed",
                  teamId,
                  tagId: row.id,
                  error: String(error),
                });
              }
            }),
          ),
        );
        applyMissingPolicies(tagsTree, saved);
        logger.info({
          msg: "Evidence policy batch completed",
          teamId,
          batchSize: pending.length,
          persisted: saved.size,
        });
      } catch (error) {
        // Structured-output/context limits are payload-specific: split this
        // failed batch, rather than retrying the same oversized request forever.
        const payloadFailure =
          /NoObjectGenerated|NoOutputGenerated|JSONParse|TypeValidation|context.{0,20}(length|limit)|output.{0,20}(length|limit)/i.test(
            `${(error as Error)?.name} ${(error as Error)?.message}`,
          );
        if (!leaseAbort.signal.aborted && payloadFailure && batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          batches.splice(batchIndex + 1, 0, batch.slice(0, middle), batch.slice(middle));
          continue;
        }
        incomplete = true;
        logger.warn({
          msg: "Evidence policy batch failed; retained previous progress",
          teamId,
          batchSize: batch.length,
          error: String(error),
        });
        break; // Avoid hammering a failed provider with every remaining batch.
      }
    }
  } finally {
    clearInterval(heartbeat);
    if (incomplete) retryAfter.set(teamId, Date.now() + 60_000);
    if (incomplete)
      await prisma.teamConfig.updateMany({
        where: ownedLease,
        data: { value: { owner, expiresAt: Date.now() + 60_000 } },
      });
    else await prisma.teamConfig.deleteMany({ where: ownedLease });
  }
  return saved;
}

export async function ensureEvidencePolicies({
  teamId,
  tagsTree,
}: {
  teamId: number;
  tagsTree: TagWithChildren[];
}): Promise<{ classified: number }> {
  if (!collectTagsMissingEvidencePolicy(tagsTree).length) return { classified: 0 };
  let job = inFlight.get(teamId);
  if (!job) {
    if ((retryAfter.get(teamId) ?? 0) > Date.now()) return { classified: 0 };
    job = initializationLimit(() => initializePolicies(teamId, tagsTree));
    inFlight.set(teamId, job);
  }
  try {
    const saved = await job;
    applyMissingPolicies(tagsTree, saved);
    return { classified: saved.size };
  } finally {
    if (inFlight.get(teamId) === job) inFlight.delete(teamId);
  }
}

/** 打标预测专用：拉取标签树并保证每个节点都有证据策略。 */
export async function fetchTagsTreeForTagging({ teamId }: { teamId: number }) {
  const tagsTree = await fetchTagsTree({ teamId });
  if (tagsTree.length > 0) {
    void ensureEvidencePolicies({ teamId, tagsTree }).catch((error) => {
      retryAfter.set(teamId, Date.now() + 60_000);
      logger.warn({
        msg: "Background evidence policy initialization failed",
        teamId,
        error: String(error),
      });
    });
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
      if ((tag.extra as AssetTagExtra | null)?.configurationSource === "import") continue;
      const { extra, downgraded } = applyContentOnlyRejection(tag.extra as AssetTagExtra | null);
      const written = await prisma.assetTag.updateMany({
        where: {
          id: tag.id,
          teamId: item.teamId,
          extra: { equals: tag.extra === null ? Prisma.JsonNull : tag.extra },
        },
        data: { extra },
      });
      if (written.count && downgraded) {
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
