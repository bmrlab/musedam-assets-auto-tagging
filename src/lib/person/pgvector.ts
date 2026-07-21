import "server-only";

import { deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";
import prisma from "@/prisma/prisma";

export type PersonVectorPayload = {
  teamId: number;
  assetPersonId: string;
  assetPersonImageId: string;
  personTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
};

export type PgVectorPersonCandidate = {
  assetPersonId: string;
  rawSimilarity: number;
  supportingReferenceCount: number;
};

const TABLE_NAME = "PersonVector";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Person embedding must contain finite numeric values");
  }

  return `'[${vector.join(",")}]'::vector`;
}

/**
 * Rank identities rather than individual reference images. Applying LIMIT
 * after GROUP BY prevents a person with many references from hiding the true
 * runner-up identity and creating an artificially large acceptance margin.
 */
export async function queryPersonVectorCandidates({
  teamId,
  vector,
  limit,
  candidateScoreFloor,
  supportingScoreThreshold,
}: {
  teamId: number;
  vector: number[];
  limit: number;
  candidateScoreFloor: number;
  supportingScoreThreshold: number;
}): Promise<PgVectorPersonCandidate[]> {
  const query = `
    WITH scored AS MATERIALIZED (
      SELECT
        "assetPersonId",
        1 - ("embedding" <=> ${vectorToSql(vector)}) AS similarity
      FROM "${TABLE_NAME}"
      WHERE "teamId" = $1 AND "enabled" = true AND "status" = 'completed'
    )
    SELECT
      "assetPersonId",
      MAX(similarity)::double precision AS "rawSimilarity",
      COUNT(*) FILTER (WHERE similarity >= $3)::integer AS "supportingReferenceCount"
    FROM scored
    WHERE similarity >= $2
    GROUP BY "assetPersonId"
    ORDER BY "rawSimilarity" DESC
    LIMIT $4
  `;

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      assetPersonId: string;
      rawSimilarity: number;
      supportingReferenceCount: number;
    }>
  >(query, teamId, candidateScoreFloor, supportingScoreThreshold, limit);

  return rows.map((row) => ({
    assetPersonId: row.assetPersonId,
    rawSimilarity: Number(row.rawSimilarity),
    supportingReferenceCount: Number(row.supportingReferenceCount),
  }));
}

export async function deletePersonVectorPointsByPerson({
  teamId,
  assetPersonId,
}: {
  teamId: number;
  assetPersonId: string;
}): Promise<void> {
  await deletePointsByFilter(TABLE_NAME, `"teamId" = $1 AND "assetPersonId" = $2::uuid`, [
    teamId,
    assetPersonId,
  ]);
}

export async function setPersonVectorPayloadByPerson({
  teamId,
  assetPersonId,
  payload,
}: {
  teamId: number;
  assetPersonId: string;
  payload: Partial<PersonVectorPayload>;
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
  if (payload.personTypeId !== undefined) {
    setFields.push(`"personTypeId" = $${paramIndex}`);
    params.push(payload.personTypeId);
    paramIndex++;
  }

  if (setFields.length === 0) {
    return;
  }

  params.push(teamId, assetPersonId);

  const query = `
    UPDATE "${TABLE_NAME}"
    SET ${setFields.join(", ")}
    WHERE "teamId" = $${paramIndex} AND "assetPersonId" = $${paramIndex + 1}::uuid
  `;

  await executeRawUpdate(query, params);
}

export async function upsertPersonVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: PersonVectorPayload;
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
      p.payload.assetPersonId,
      p.payload.assetPersonImageId,
      p.payload.personTypeId,
    );
  }

  const query = `
    INSERT INTO "${TABLE_NAME}" ("id", "teamId", "enabled", "status", "assetPersonId", "assetPersonImageId", "personTypeId", "embedding", "createdAt", "updatedAt")
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
      "assetPersonId" = EXCLUDED."assetPersonId",
      "assetPersonImageId" = EXCLUDED."assetPersonImageId",
      "personTypeId" = EXCLUDED."personTypeId",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  await executeRawInsert(query, params);
}
