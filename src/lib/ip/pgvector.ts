import "server-only";

import { querySimilarVectors, deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";

export type IpVectorPayload = {
  teamId: number;
  assetIpId: string;
  assetIpImageId: string | null;
  ipTypeId: string | null;
  enabled: boolean;
  matchPattern: "whole" | "partial";
  partialMatchPatternName: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  sourceType: "image" | "description";
};

export type PgVectorIpQueryPoint = {
  id: string;
  score: number;
  payload?: Partial<IpVectorPayload>;
};

const TABLE_NAME = "IpVector";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  return `'[${vector.join(",")}]'::vector`;
}

export async function deleteIpVectorPointsByIp({
  teamId,
  assetIpId,
}: {
  teamId: number;
  assetIpId: string;
}): Promise<void> {
  await deletePointsByFilter(
    TABLE_NAME,
    `"teamId" = $1 AND "assetIpId" = $2::uuid`,
    [teamId, assetIpId],
  );
}

export async function setIpVectorPayloadByIp({
  teamId,
  assetIpId,
  payload,
}: {
  teamId: number;
  assetIpId: string;
  payload: Partial<IpVectorPayload>;
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
  if (payload.ipTypeId !== undefined) {
    setFields.push(`"ipTypeId" = $${paramIndex}`);
    params.push(payload.ipTypeId);
    paramIndex++;
  }
  if (payload.matchPattern !== undefined) {
    setFields.push(`"matchPattern" = $${paramIndex}`);
    params.push(payload.matchPattern);
    paramIndex++;
  }
  if (payload.partialMatchPatternName !== undefined) {
    setFields.push(`"partialMatchPatternName" = $${paramIndex}`);
    params.push(payload.partialMatchPatternName);
    paramIndex++;
  }
  if (payload.sourceType !== undefined) {
    setFields.push(`"sourceType" = $${paramIndex}`);
    params.push(payload.sourceType);
    paramIndex++;
  }

  if (setFields.length === 0) {
    return;
  }

  params.push(teamId, assetIpId);

  const query = `
    UPDATE "${TABLE_NAME}"
    SET ${setFields.join(", ")}
    WHERE "teamId" = $${paramIndex} AND "assetIpId" = $${paramIndex + 1}::uuid
  `;

  await executeRawUpdate(query, params);
}

export async function upsertIpVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: IpVectorPayload;
  }>,
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  // Build multi-value insert with conflict resolution
  const params: (string | number | boolean | null)[] = [];

  const valueTuples: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // 10 parameters per point (id, teamId, enabled, status, assetIpId, assetIpImageId, matchPattern, ipTypeId, partialMatchPatternName, sourceType)
    const base = i * 10 + 1;
    valueTuples.push(
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::uuid, $${base + 5}::uuid, $${base + 6}, $${base + 7}::uuid, $${base + 8}, $${base + 9}, ${vectorToSql(p.vector)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );
    params.push(
      p.id,
      p.payload.teamId,
      p.payload.enabled,
      p.payload.status,
      p.payload.assetIpId,
      p.payload.assetIpImageId,
      p.payload.matchPattern,
      p.payload.ipTypeId,
      p.payload.partialMatchPatternName,
      p.payload.sourceType,
    );
  }

  const query = `
    INSERT INTO "${TABLE_NAME}" ("id", "teamId", "enabled", "status", "assetIpId", "assetIpImageId", "matchPattern", "ipTypeId", "partialMatchPatternName", "sourceType", "embedding", "createdAt", "updatedAt")
    VALUES ${valueTuples.join(", ")}
    ON CONFLICT ("id") DO UPDATE SET
      "teamId" = EXCLUDED."teamId",
      "enabled" = EXCLUDED."enabled",
      "status" = EXCLUDED."status",
      "assetIpId" = EXCLUDED."assetIpId",
      "assetIpImageId" = EXCLUDED."assetIpImageId",
      "matchPattern" = EXCLUDED."matchPattern",
      "ipTypeId" = EXCLUDED."ipTypeId",
      "partialMatchPatternName" = EXCLUDED."partialMatchPatternName",
      "sourceType" = EXCLUDED."sourceType",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  await executeRawInsert(query, params);
}

export async function queryIpVectorPoints({
  teamId,
  vector,
  limit,
  scoreThreshold,
  sourceType,
}: {
  teamId: number;
  vector: number[];
  limit: number;
  scoreThreshold?: number;
  sourceType?: IpVectorPayload["sourceType"];
}): Promise<PgVectorIpQueryPoint[]> {
  const filters = [`"teamId" = $1`, `"enabled" = true`, `"status" = 'completed'`];
  const params: (number | string)[] = [teamId];

  if (sourceType) {
    filters.push(`"sourceType" = $2`);
    params.push(sourceType);
  }

  const results = await querySimilarVectors(
    TABLE_NAME,
    {
      vector,
      limit,
      scoreThreshold,
      whereClause: filters.join(" AND "),
      params,
      columns: ["id", "teamId", "enabled", "status", "assetIpId", "assetIpImageId", "ipTypeId", "matchPattern", "partialMatchPatternName", "sourceType", "embeddingModel", "createdAt", "updatedAt"],
    },
  );

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    payload: {
      teamId: r.payload.teamId as number,
      assetIpId: r.payload.assetIpId as string,
      assetIpImageId: r.payload.assetIpImageId as string | null,
      ipTypeId: r.payload.ipTypeId as string | null,
      enabled: r.payload.enabled as boolean,
      matchPattern: r.payload.matchPattern as "whole" | "partial",
      partialMatchPatternName: r.payload.partialMatchPatternName as string | null,
      status: r.payload.status as IpVectorPayload["status"],
      sourceType: r.payload.sourceType as IpVectorPayload["sourceType"],
    },
  }));
}
