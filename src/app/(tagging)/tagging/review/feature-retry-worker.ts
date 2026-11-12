import { assertQueueExecutionOwned } from "@/lib/tagging/queue-execution";
import type { Prisma, TaggingQueueItemResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import "server-only";
import { isScopedFeatureReviewComplete } from "./feature-review";

/** Merge only feature evidence; keep tags, metadata, manual edits and reviewed rows intact. */
export async function saveFeatureRetry(
  teamId: number,
  sourceId: number,
  jobId: number,
  features: TaggingQueueItemResult,
  sourceStartedAt?: string | null,
) {
  await assertQueueExecutionOwned();
  await prisma.$transaction(async (tx) => {
    const source = await tx.taggingQueueItem.findFirstOrThrow({ where: { id: sourceId, teamId } });
    if (
      source.status !== "completed" ||
      (source.startsAt?.toISOString() ?? null) !== (sourceStartedAt ?? null)
    )
      throw Error("FEATURE_RETRY_SUPERSEDED");
    if (isScopedFeatureReviewComplete(source)) throw Error("FEATURE_REVIEW_ALREADY_COMPLETE");
    const newer = await tx.taggingAuditItem.findFirst({
      where: {
        teamId,
        assetObjectId: source.assetObjectId,
        queueItem: { createdAt: { gt: source.createdAt }, id: { not: jobId } },
      },
      select: { id: true },
    });
    if (newer) throw Error("FEATURE_RETRY_SUPERSEDED");
    const old = (source.result ?? {}) as TaggingQueueItemResult;
    const merged = { ...old, ...features, outputTypes: { ...old.outputTypes, features: true } };
    const updated = await tx.taggingQueueItem.updateMany({
      where: { id: sourceId, teamId, updatedAt: source.updatedAt },
      data: { result: merged as Prisma.InputJsonObject },
    });
    if (!updated.count) throw Error("FEATURE_REVIEW_CHANGED");
    const pending = await tx.taggingAuditItem.findFirst({
      where: { teamId, queueItemId: sourceId, status: "pending" },
      select: { id: true },
    });
    const hasCandidates =
      !!features.featureDecision?.decision.result?.matches.length ||
      !!features.brandRecommendation ||
      !!features.ipRecommendation ||
      !!features.productRecommendation;
    if (!pending && hasCandidates)
      await tx.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: source.assetObjectId,
          queueItemId: sourceId,
          status: "pending",
          tagPath: [],
          leafTagId: null,
          score: 0,
        },
      });
    await assertQueueExecutionOwned();
    await tx.taggingQueueItem.update({
      where: { id: jobId, teamId },
      data: {
        status: "completed",
        endsAt: new Date(),
        result: { outputTypes: { tags: false, fields: false, features: true } },
      },
    });
  });
}
