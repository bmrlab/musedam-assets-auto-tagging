"use server";
import { checkUserPermission } from "@/app/(auth)/lib";
import { withAuth } from "@/app/(auth)/withAuth";
import { TAGGING_CONFIG_KEYS } from "@/app/(tagging)/types";
import type { MetadataPrediction } from "@/lib/metadata/types";
import { slugToId } from "@/lib/slug";
import {
  applyMetadataPredictions,
  fetchMetadataContext,
  fetchMetadataValues,
} from "@/musedam/metadata";
import { Prisma, type TaggingAuditStatus } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { getTaggingSettings } from "../settings/lib";

export async function fetchMetadataReviews(page = 1, status: TaggingAuditStatus = "pending") {
  return withAuth(async ({ team, user }) => {
    await checkUserPermission({ team, user });
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !["pending", "approved", "rejected"].includes(status)
    )
      throw new Error("Invalid query");
    const where = { teamId: team.id, status };
    const [rows, total] = await Promise.all([
      prisma.metadataAuditItem.findMany({
        where,
        include: { assetObject: { select: { name: true, slug: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.metadataAuditItem.count({ where }),
    ]);
    // Refresh per-asset field definitions once so deleted/disabled/changed fields cannot be added.
    const contexts = new Map(
      await Promise.all(
        [...new Set(rows.map((r) => r.assetObject.slug))].map(
          async (slug) =>
            [
              slug,
              await fetchMetadataContext(team, slugToId("assetObject", slug).toString()),
            ] as const,
        ),
      ),
    );
    return {
      rows: rows.map((row) => {
        const prediction = row.prediction as unknown as MetadataPrediction;
        const context = contexts.get(row.assetObject.slug)!;
        const current = context.fields.find((f) => f.fieldId === row.fieldId);
        return {
          id: row.id,
          assetObjectId: row.assetObjectId,
          name: row.assetObject.name,
          status: row.status,
          prediction,
          available:
            context.enabled &&
            !!current &&
            current.fieldVersion === prediction.expectedFieldVersion,
        };
      }),
      total,
    };
  });
}

export async function reviewMetadata(ids: number[], action: "approve" | "reject") {
  return withAuth(async ({ team, user }) => {
    await checkUserPermission({ team, user });
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => !Number.isSafeInteger(id)) ||
      !["approve", "reject"].includes(action)
    )
      throw new Error("Invalid review");
    const rows = await prisma.metadataAuditItem.findMany({
      where: { teamId: team.id, id: { in: [...new Set(ids)] } },
      include: { assetObject: true },
    });
    if (rows.length !== new Set(ids).size) throw new Error("Invalid review items");
    const settings = await getTaggingSettings(team.id);
    if (action === "approve" && !settings.isMetadataEnabled)
      throw new Error("Metadata filling paused");
    let applied = 0,
      skipped = 0;
    for (const row of rows.sort((a, b) => a.id - b.id)) {
      const accepted = await prisma.$transaction(
        async (tx) => {
          // Row lock serializes approve/reject across workers. The remote request uses a stable receipt key;
          // if remote succeeds and this transaction fails, retry safely reads that receipt.
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "MetadataAuditItem" WHERE "id" = ${row.id} AND "teamId" = ${team.id} FOR UPDATE`,
          );
          const current = await tx.metadataAuditItem.findUniqueOrThrow({ where: { id: row.id } });
          if (current.status !== "pending") return null;
          if (action === "reject") {
            await tx.metadataAuditItem.update({
              where: { id: row.id },
              data: { status: "rejected" },
            });
            return false;
          }
          const currentSwitch = await tx.teamConfig.findUnique({
            where: {
              teamId_key: { teamId: team.id, key: TAGGING_CONFIG_KEYS.IS_METADATA_ENABLED },
            },
          });
          if (currentSwitch?.value !== true) throw new Error("Metadata filling paused");
          const result = await applyMetadataPredictions(
            team,
            slugToId("assetObject", row.assetObject.slug).toString(),
            [current.prediction as unknown as MetadataPrediction],
            `metadata:review:${row.id}`,
          );
          const written = result.applied.includes(row.fieldId);
          await tx.metadataAuditItem.update({
            where: { id: row.id },
            data: { status: written ? "approved" : "rejected" },
          });
          return written;
        },
        { timeout: 35000 },
      );
      if (accepted === true) applied++;
      else if (accepted === false) skipped++;
    }
    return { applied, skipped };
  });
}

export async function fetchReviewMetadataValues(assetObjectId: number) {
  return withAuth(async ({ team, user }) => {
    await checkUserPermission({ team, user });
    if (!Number.isSafeInteger(assetObjectId) || assetObjectId <= 0)
      throw new Error("Invalid asset");
    const asset = await prisma.assetObject.findFirstOrThrow({
      where: { id: assetObjectId, teamId: team.id },
      select: { slug: true },
    });
    const materialId = slugToId("assetObject", asset.slug).toString();
    const records = await fetchMetadataValues(team, materialId);
    return records[materialId] || {};
  });
}
