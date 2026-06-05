import "server-only";

import { querySimilarVectors, deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";

export type LogoVectorPayload = {
  teamId: number;
  assetLogoId: string;
  assetLogoImageId: string;
  logoTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
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
  await deletePointsByFilter(
    TABLE_NAME,
    `"teamId" = $1 AND "assetLogoId" = $2::uuid`,
    [teamId, assetLogoId],
  );
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
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::uuid, $${base + 5}::uuid, $${base + 6}::uuid)`
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
    VALUES ${valuePlaceholders.map((ph, idx) => {
      const p = points[idx];
      return `${ph.slice(0, -1)}, ${vectorToSql(p.vector)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
    }).join(", ")}
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
  const results = await querySimilarVectors(
    TABLE_NAME,
    {
      vector,
      limit,
      scoreThreshold,
      whereClause: `"teamId" = $1 AND "enabled" = true AND "status" = 'completed'`,
      params: [teamId],
      columns: ["id", "teamId", "enabled", "status", "assetLogoId", "assetLogoImageId", "logoTypeId", "embeddingModel", "createdAt", "updatedAt"],
    },
  );

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    payload: {
      teamId: r.payload.teamId as number,
      assetLogoId: r.payload.assetLogoId as string,
      assetLogoImageId: r.payload.assetLogoImageId as string,
      logoTypeId: r.payload.logoTypeId as string | null,
      enabled: r.payload.enabled as boolean,
      status: r.payload.status as LogoVectorPayload["status"],
    },
  }));
}
