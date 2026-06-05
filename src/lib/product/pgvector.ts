import "server-only";

import { querySimilarVectors, deletePointsByFilter, executeRawInsert, executeRawUpdate } from "@/lib/pgvector/client";

export type ProductVectorPayload = {
  teamId: number;
  assetProductId: string;
  assetProductImageId: string | null;
  productTypeId: string | null;
  generalCategory: string;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  sourceType: "image" | "description";
};

export type PgVectorProductQueryPoint = {
  id: string;
  score: number;
  payload?: Partial<ProductVectorPayload>;
};

const TABLE_NAME = "ProductVector";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  return `'[${vector.join(",")}]'::vector`;
}

export async function deleteProductVectorPointsByProduct({
  teamId,
  assetProductId,
}: {
  teamId: number;
  assetProductId: string;
}): Promise<void> {
  await deletePointsByFilter(
    TABLE_NAME,
    `"teamId" = $1 AND "assetProductId" = $2::uuid`,
    [teamId, assetProductId],
  );
}

export async function setProductVectorPayloadByProduct({
  teamId,
  assetProductId,
  payload,
}: {
  teamId: number;
  assetProductId: string;
  payload: Partial<ProductVectorPayload>;
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
  if (payload.productTypeId !== undefined) {
    setFields.push(`"productTypeId" = $${paramIndex}`);
    params.push(payload.productTypeId);
    paramIndex++;
  }
  if (payload.generalCategory !== undefined) {
    setFields.push(`"generalCategory" = $${paramIndex}`);
    params.push(payload.generalCategory);
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

  params.push(teamId, assetProductId);

  const query = `
    UPDATE "${TABLE_NAME}"
    SET ${setFields.join(", ")}
    WHERE "teamId" = $${paramIndex} AND "assetProductId" = $${paramIndex + 1}::uuid
  `;

  await executeRawUpdate(query, params);
}

export async function upsertProductVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: ProductVectorPayload;
  }>,
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  // Build multi-value insert with conflict resolution
  const valuePlaceholders: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  const valueTuples: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // 9 parameters per point (id, teamId, enabled, status, generalCategory, assetProductId, assetProductImageId, productTypeId, sourceType)
    const base = i * 9 + 1;
    valueTuples.push(
      `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::uuid, $${base + 6}::uuid, $${base + 7}::uuid, $${base + 8}, ${vectorToSql(p.vector)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );
    params.push(
      p.id,
      p.payload.teamId,
      p.payload.enabled,
      p.payload.status,
      p.payload.generalCategory,
      p.payload.assetProductId,
      p.payload.assetProductImageId,
      p.payload.productTypeId,
      p.payload.sourceType,
    );
  }

  const query = `
    INSERT INTO "${TABLE_NAME}" ("id", "teamId", "enabled", "status", "generalCategory", "assetProductId", "assetProductImageId", "productTypeId", "sourceType", "embedding", "createdAt", "updatedAt")
    VALUES ${valueTuples.join(", ")}
    ON CONFLICT ("id") DO UPDATE SET
      "teamId" = EXCLUDED."teamId",
      "enabled" = EXCLUDED."enabled",
      "status" = EXCLUDED."status",
      "generalCategory" = EXCLUDED."generalCategory",
      "assetProductId" = EXCLUDED."assetProductId",
      "assetProductImageId" = EXCLUDED."assetProductImageId",
      "productTypeId" = EXCLUDED."productTypeId",
      "sourceType" = EXCLUDED."sourceType",
      "embedding" = EXCLUDED."embedding",
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  await executeRawInsert(query, params);
}

export async function queryProductVectorPoints({
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
  sourceType?: ProductVectorPayload["sourceType"];
}): Promise<PgVectorProductQueryPoint[]> {
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
      columns: ["id", "teamId", "enabled", "status", "assetProductId", "assetProductImageId", "productTypeId", "generalCategory", "sourceType", "embeddingModel", "createdAt", "updatedAt"],
    },
  );

  return results.map((r) => ({
    id: r.id,
    score: r.score,
    payload: {
      teamId: r.payload.teamId as number,
      assetProductId: r.payload.assetProductId as string,
      assetProductImageId: r.payload.assetProductImageId as string | null,
      productTypeId: r.payload.productTypeId as string | null,
      generalCategory: r.payload.generalCategory as string,
      enabled: r.payload.enabled as boolean,
      status: r.payload.status as ProductVectorPayload["status"],
      sourceType: r.payload.sourceType as ProductVectorPayload["sourceType"],
    },
  }));
}
