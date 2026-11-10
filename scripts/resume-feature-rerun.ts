/** Dry-run by default. Deploy, rerun the green-tea canary in review, then use --apply. */
import { loadEnvConfig } from "@next/env";
import { PrismaClient, Prisma } from "../src/prisma/client";
import { hasFeatureRecognitionFailure } from "../src/lib/feature-decision/completion";
import { FEATURE_TEXT_DECISION_SYSTEM_PROMPT } from "../src/lib/feature-decision/prompts";
import type { FeatureDecisionDiagnostics } from "../src/lib/feature-decision/types";
loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const batch = "team1-fixes-20261106-8949b1e";
const object = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, any>;
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "pc-2zegr04z619du63hn.rwlb.rds.aliyuncs.com" || url.pathname !== "/musedam_assets_auto_tagging") throw Error("Expected the configured test database");
  const apply = process.argv.includes("--apply");
  if (apply) {
    // Require a real completed queue task from the deployed worker, not a local model replay.
    const canary = await prisma.taggingQueueItem.findFirst({ where: { teamId: 1, assetObjectId: 2126 }, orderBy: { createdAt: "desc" } });
    const d = object(canary?.result).featureDecision as FeatureDecisionDiagnostics | undefined;
    const request = d?.decision.call?.request;
    const matches = d?.decision.result?.matches ?? [];
    if (!canary || canary.status !== "completed" || Date.now() - canary.updatedAt.getTime() > 30 * 60_000 ||
      !d || hasFeatureRecognitionFailure(d) ||
      request?.enable_thinking !== false ||
      request.messages[0]?.content !== FEATURE_TEXT_DECISION_SYSTEM_PROMPT ||
      !matches.some(m => m.candidateId === "product:bb7bf703-697f-4261-9719-e973f9268608" && m.confidence >= 60 && !m.conflicts.length && !m.specificityLimit) ||
      matches.some(m => m.candidateId === "product:6924a145-dcdf-4298-a3a9-cd250f269059" && m.confidence >= 60)) {
      throw Error("Deploy this revision and rerun 绿茶牛奶水15ml_正面 first; a successful recent worker canary is required");
    }
  }
  const rows = await prisma.taggingQueueItem.findMany({ where: { teamId: 1, status: "failed", extra: { path: ["featureFixRerunBatch"], equals: batch }, result: { path: ["error"], equals: "RERUN_REFRESH_REQUIRED" } }, orderBy: { id: "asc" } });
  if (!apply) {
    const assets = await prisma.assetObject.findMany({ where: { id: { in: rows.flatMap(row => row.assetObjectId ? [row.assetObjectId] : []) }, teamId: 1 }, select: { id: true, extra: true, taggingQueueItems: { orderBy: { createdAt: "desc" }, take: 1, include: { taggingAuditItems: { select: { status: true } } } } } });
    const active = await prisma.taggingQueueItem.findMany({ where: { teamId: 1, status: { in: ["pending", "processing"] } }, select: { assetObjectId: true } });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const asset = assets.find(asset => asset.id === row.assetObjectId);
      const latest = asset?.taggingQueueItems[0];
      const outcome = object(row.extra).resumedQueueId ? "already_resumed" : !asset || object(asset.extra).reviewAssetDeleted ? "deleted" : latest?.taggingAuditItems.some(a => a.status !== "pending") ? "reviewed_preserved" : active.some(q => q.assetObjectId === row.assetObjectId) ? "active_preserved" : latest && latest.id !== row.id && latest.status === "completed" && !hasFeatureRecognitionFailure(object(latest.result).featureDecision) ? "newer_completed_preserved" : "ready";
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
    console.log(JSON.stringify({ mode: "dry-run", total: rows.length, counts }));
    return;
  }
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const outcome = await prisma.$transaction(async tx => {
      if (!row.assetObjectId) return "missing_asset";
      await tx.$queryRaw`SELECT id FROM "AssetObject" WHERE id=${row.assetObjectId} AND "teamId"=1 FOR UPDATE`;
      const fresh = await tx.taggingQueueItem.findUniqueOrThrow({ where: { id: row.id } });
      if (object(fresh.extra).resumedQueueId) return "already_resumed";
      const mode = await tx.teamConfig.findUnique({ where: { teamId_key: { teamId: 1, key: "taggingMode" } } });
      if (mode?.value !== "review") throw Error("Review mode is required");
      const asset = await tx.assetObject.findUnique({ where: { id: row.assetObjectId } });
      if (!asset || object(asset.extra).reviewAssetDeleted) return "deleted";
      const latest = await tx.taggingQueueItem.findFirst({ where: { teamId: 1, assetObjectId: row.assetObjectId }, orderBy: { createdAt: "desc" }, include: { taggingAuditItems: { select: { status: true } } } });
      if (latest?.taggingAuditItems.some(a => a.status !== "pending")) return "reviewed_preserved";
      if (await tx.taggingQueueItem.count({ where: { teamId: 1, assetObjectId: row.assetObjectId, status: { in: ["pending", "processing"] } } })) return "active_preserved";
      if (latest && latest.id !== row.id && latest.status === "completed" && !hasFeatureRecognitionFailure(object(latest.result).featureDecision)) return "newer_completed_preserved";
      const queued = await tx.taggingQueueItem.create({ data: { teamId: 1, assetObjectId: row.assetObjectId, taskType: row.taskType, status: "pending", extra: { ...object(row.extra), featureFixRerunBatch: `${batch}-resume-v2`, rerunSourceQueueItemId: row.id } as Prisma.InputJsonObject } });
      await tx.taggingQueueItem.update({ where: { id: row.id }, data: { extra: { ...object(fresh.extra), resumedQueueId: queued.id } as Prisma.InputJsonObject } });
      return "queued";
    }, { timeout: 20_000 });
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", total: rows.length, counts }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
