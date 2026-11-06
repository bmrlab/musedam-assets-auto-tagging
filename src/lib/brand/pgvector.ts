import "server-only";

import { deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";
import prisma from "@/prisma/prisma";

export type LogoVectorPayload = {
  teamId: number;
  assetLogoId: string;
  assetLogoImageId: string;
  logoTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  referenceMatchStrategy?: "highest" | "average";
};

export type PgVectorLogoQueryPoint = {
  id: string;
  score: number;
  payload?: Partial<LogoVectorPayload>;
};

const TABLE_NAME = "LogoVector";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  return `'[${vector.join(",")}]'::vector`;
}

export async function deleteLogoVectorPointsByLogo({
  teamId,
  assetLogoId,
}: {
  teamId: number;
  assetLogoId: string;
}): Promise<void> {
  await deletePointsByFilter(TABLE_NAME, `"teamId" = $1 AND "assetLogoId" = $2::uuid`, [
    teamId,
    assetLogoId,
  ]);
}

export async function setLogoVectorPayloadByLogo({
  teamId,
  assetLogoId,
  payload,
}: {
  teamId: number;
  assetLogoId: string;
  payload: Partial<LogoVectorPayload>;
}): Promise<void> {
  const setFields: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  let paramIndex = 1;

  if (payload.enabled !== undefined) {
    setFields.push(`"enabled" = $${paramIndex}`);
    params.push(payload.enabled);
    paramIndex++;
  }
  if (payload.status !== undefined) {
    setFields.push(`"status" = $${paramIndex}`);
    params.push(payload.status);
    paramIndex++;
  }
  if (payload.logoTypeId !== undefined) {
    setFields.push(`"logoTypeId" = $${paramIndex}`);
    params.push(payload.logoTypeId);
    paramIndex++;
  }

  if (setFields.length === 0) {
    return;
  }

  params.push(teamId, assetLogoId);

  const query = `
    UPDATE "${TABLE_NAME}"
    SET ${setFields.join(", ")}
    WHERE "teamId" = $${paramIndex} AND "assetLogoId" = $${paramIndex + 1}::uuid
  `;

  await executeRawUpdate(query, params);
}

export async function upsertLogoVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: LogoVectorPayload;
  }>,
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  // Build multi-value insert with conflict resolution
  const valuePlaceholders: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  for (let i = 0; i < points.length; i++) {
    const base = i * 7 + 1;
    const p = points[i];
    valuePlaceholders.push(
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::uuid, $${base + 5}::uuid, $${base + 6}::uuid)`,
    );
    params.push(
      p.id,
      p.payload.teamId,
      p.payload.enabled,
      p.payload.status,
      p.payload.assetLogoId,
      p.payload.assetLogoImageId,
      p.payload.logoTypeId,
    );
  }

  const query = `
    INSERT INTO "${TABLE_NAME}" ("id", "teamId", "enabled", "status", "assetLogoId", "assetLogoImageId", "logoTypeId", "embedding", "createdAt", "updatedAt")
    VALUES ${valuePlaceholders
      .map((ph, idx) => {
        const p = points[idx];
        return `${ph.slice(0, -1)}, ${vectorToSql(p.vector)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      })
      .join(", ")}
    ON CONFLICT ("id") DO UPDATE SET
      "teamId" = EXCLUDED."teamId",
      "enabled" = EXCLUDED."enabled",
      "status" = EXCLUDED."status",
      "assetLogoId" = EXCLUDED."assetLogoId",
      "assetLogoImageId" = EXCLUDED."assetLogoImageId",
      "logoTypeId" = EXCLUDED."logoTypeId",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  await executeRawInsert(query, params);
}

export async function queryLogoVectorPoints({
  teamId,
  vector,
  limit,
  scoreThreshold,
}: {
  teamId: number;
  vector: number[];
  limit: number;
  scoreThreshold?: number;
}): Promise<PgVectorLogoQueryPoint[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Logo vector query limit must be a positive integer");
  }
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Logo query vector must contain only finite values");
  }
  if (scoreThreshold !== undefined && !Number.isFinite(scoreThreshold)) {
    throw new Error("Logo vector score threshold must be finite");
  }

  // Rank identities, not individual image points. `highest` keeps the best reference while
  // `average` requires the query crop to agree with the reference set as a whole. Doing the
  // aggregation before LIMIT also prevents a logo with many images from crowding other classes
  // out of the regional top-k candidate budget.
  const query = `
    WITH "referenceScores" AS (
      SELECT
        v."assetLogoId",
        v."assetLogoImageId",
        l."referenceMatchStrategy",
        1 - (v."embedding" <=> $2::vector) AS "pointSimilarity"
      FROM "${TABLE_NAME}" v
      INNER JOIN "AssetLogo" l ON l."id" = v."assetLogoId"
      WHERE v."teamId" = $1
        AND v."enabled" = true
        AND v."status" = 'completed'
        AND l."teamId" = $1
        AND l."enabled" = true
        AND l."status" = 'completed'
    ),
    "classScores" AS (
      SELECT
        "assetLogoId",
        "referenceMatchStrategy",
        CASE
          WHEN "referenceMatchStrategy" = 'average'
            THEN AVG("pointSimilarity")
          ELSE MAX("pointSimilarity")
        END AS "similarity",
        (ARRAY_AGG(
          "assetLogoImageId"
          ORDER BY "pointSimilarity" DESC, "assetLogoImageId" ASC
        ))[1] AS "matchedReferenceImageId"
      FROM "referenceScores"
      GROUP BY "assetLogoId", "referenceMatchStrategy"
    )
    SELECT
      "assetLogoId",
      "referenceMatchStrategy",
      "similarity",
      "matchedReferenceImageId"
    FROM "classScores"
    WHERE $3::double precision IS NULL OR "similarity" >= $3
    ORDER BY "similarity" DESC, "assetLogoId" ASC
    LIMIT $4
  `;
  const results = await prisma.$queryRawUnsafe<
    Array<{
      assetLogoId: string;
      referenceMatchStrategy: "highest" | "average";
      similarity: number;
      matchedReferenceImageId: string;
    }>
  >(query, teamId, `[${vector.join(",")}]`, scoreThreshold ?? null, limit);

  return results.map((r) => ({
    id: r.assetLogoId,
    score: Number(r.similarity),
    payload: {
      teamId,
      assetLogoId: r.assetLogoId,
      assetLogoImageId: r.matchedReferenceImageId,
      enabled: true,
      status: "completed",
      referenceMatchStrategy: r.referenceMatchStrategy,
    },
  }));
}
