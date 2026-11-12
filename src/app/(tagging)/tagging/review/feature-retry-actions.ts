"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { kickQueueProcessing } from "@/app/(tagging)/queue";
import { hasFeatureRecognitionFailure } from "@/lib/feature-decision/completion";
import { resolveFeatureClassificationFlags } from "@/lib/feature-library";
import { getServerFeatureLibraryFeatures } from "@/lib/feature-library-server";
import { assertTeamTaggingEnabled } from "@/lib/tagging/team-suspension";
import { Prisma, type TaggingQueueItemExtra, type TaggingQueueItemResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { isScopedFeatureReviewComplete } from "./feature-review";

export async function getFeatureRetryStatus(sourceId: number) {
  return withAuth(async ({ team: { id: teamId } }) => {
    const source = await prisma.taggingQueueItem.findFirstOrThrow({
      where: { id: sourceId, teamId },
      select: { id: true, startsAt: true, extra: true },
    });
    const job = await prisma.taggingQueueItem.findFirst({
      where: {
        id: (source.extra as TaggingQueueItemExtra)?.featureRetryJobId ?? -1,
        teamId,
        AND: [
          { extra: { path: ["featureRetrySourceQueueItemId"], equals: sourceId } },
          {
            extra: {
              path: ["featureRetrySourceStartedAt"],
              equals: source.startsAt?.toISOString() ?? Prisma.JsonNull,
            },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    return {
      success: true as const,
      data: job,
    };
  });
}

export async function retryFeatures(sourceId: number) {
  return withAuth(async ({ team: { id: teamId } }) => {
    const enabled = await getServerFeatureLibraryFeatures();
    if (!enabled.featureLibrary)
      return { success: false as const, message: "FEATURE_LIBRARY_DISABLED" };
    const job = await prisma.$transaction(async (tx) => {
      // Same team lock as normal enqueue and suspension; concurrent clicks share one job.
      await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
      await assertTeamTaggingEnabled(teamId, tx);
      const source = await tx.taggingQueueItem.findFirstOrThrow({
        where: { id: sourceId, teamId },
        include: { assetObject: true },
      });
      const result = source.result as TaggingQueueItemResult | null;
      if (
        !source.assetObject ||
        source.status !== "completed" ||
        !hasFeatureRecognitionFailure(result?.featureDecision) ||
        isScopedFeatureReviewComplete(source)
      ) {
        throw Error("FEATURE_RETRY_UNAVAILABLE");
      }
      const active = await tx.taggingQueueItem.findFirst({
        where: {
          id: (source.extra as TaggingQueueItemExtra)?.featureRetryJobId ?? -1,
          teamId,
          status: { in: ["pending", "processing"] },
          extra: { path: ["featureRetrySourceQueueItemId"], equals: sourceId },
        },
      });
      if (active) return active;
      const extra = source.extra as TaggingQueueItemExtra;
      const flags = resolveFeatureClassificationFlags(extra?.featureClassify === true, {
        brand: enabled.featureBrand && extra?.featureBrand !== false,
        product: enabled.featureProduct && extra?.featureProduct !== false,
        ip: enabled.featureIp && extra?.featureIp !== false,
        person: false,
      });
      if (!flags.brand && !flags.product && !flags.ip) throw Error("FEATURE_LIBRARY_DISABLED");
      const counts = await Promise.all([
        flags.brand
          ? tx.logoVector.count({ where: { teamId, enabled: true, status: "completed" } })
          : 0,
        flags.product
          ? tx.productVector.count({ where: { teamId, enabled: true, status: "completed" } })
          : 0,
        flags.ip ? tx.ipVector.count({ where: { teamId, enabled: true, status: "completed" } }) : 0,
      ]);
      if (!counts.some(Boolean)) throw Error("FEATURE_LIBRARY_EMPTY");
      const created = await tx.taggingQueueItem.create({
        data: {
          teamId,
          assetObjectId: source.assetObjectId,
          taskType: "manual",
          status: "pending",
          extra: {
            featureRetrySourceQueueItemId: sourceId,
            featureRetrySourceStartedAt: source.startsAt?.toISOString() ?? null,
            featureClassify: true,
            featureBrand: flags.brand,
            featureProduct: flags.product,
            featureIp: flags.ip,
            featurePerson: false,
            matchingSources: extra?.matchingSources,
            recognitionAccuracy: extra?.recognitionAccuracy,
            featureImageMode: extra?.featureImageMode,
            creditCost: 0,
          } as Prisma.InputJsonObject,
        },
      });
      const linked = await tx.taggingQueueItem.updateMany({
        where: { id: source.id, teamId, updatedAt: source.updatedAt },
        data: { extra: { ...extra, featureRetryJobId: created.id } as Prisma.InputJsonObject },
      });
      if (!linked.count) throw Error("FEATURE_REVIEW_CHANGED");
      return created;
    });
    kickQueueProcessing();
    return { success: true as const, data: { id: job.id, status: job.status } };
  });
}
