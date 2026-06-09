import "server-only";

import { querySimilarVectors, deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";

export type PersonVectorPayload = {
  teamId: number;
  assetPersonId: string;
  assetPersonImageId: string;
  personTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
};

export type PgVectorPersonQueryPoint = {
  id: string;
  score: number;
  payload?: Partial<PersonVectorPayload>;
};

const TABLE_NAME = "PersonVector";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  return `'[${vector.join(",")}]'::vector`;
}

export async function deletePersonVectorPointsByPerson({
  teamId,
  assetPersonId,
}: {
  teamId: number;
  assetPersonId: string;
}): Promise<void> {
  await deletePointsByFilter(
    TABLE_NAME,
    `"teamId" = $1 AND "assetPersonId" = $2::uuid`,
    [teamId, assetPersonId],
  );
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
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::uuid, $${base + 5}::uuid, $${base + 6}::uuid)`
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
    VALUES ${valuePlaceholders.map((ph, idx) => {
      const p = points[idx];
      return `${ph.slice(0, -1)}, ${vectorToSql(p.vector)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
    }).join(", ")}
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

export async function queryPersonVectorPoints({
  teamId,
  vector,
  limit,
  scoreThreshold,
}: {
  teamId: number;
  vector: number[];
  limit: number;
  scoreThreshold?: number;
}): Promise<PgVectorPersonQueryPoint[]> {
  const results = await querySimilarVectors(
    TABLE_NAME,
    {
      vector,
      limit,
      scoreThreshold,
      whereClause: `"teamId" = $1 AND "enabled" = true AND "status" = 'completed'`,
      params: [teamId],
      columns: ["id", "teamId", "enabled", "status", "assetPersonId", "assetPersonImageId", "personTypeId", "embeddingModel", "createdAt", "updatedAt"],
    },
  );

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    payload: {
      teamId: r.payload.teamId as number,
      assetPersonId: r.payload.assetPersonId as string,
      assetPersonImageId: r.payload.assetPersonImageId as string,
      personTypeId: r.payload.personTypeId as string | null,
      enabled: r.payload.enabled as boolean,
      status: r.payload.status as PersonVectorPayload["status"],
    },
  }));
}
