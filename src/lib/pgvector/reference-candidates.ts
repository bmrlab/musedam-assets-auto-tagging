import "server-only";

import prisma from "@/prisma/prisma";
import type { VectorQueryResult } from "./client";

// Identifiers come only from this internal allowlist; all request values are bound parameters.
const LIBRARIES = {
  product: {
    table: "ProductVector",
    catalog: "AssetProduct",
    identity: "assetProductId",
    image: "assetProductImageId",
    columns: ["productTypeId", "generalCategory"],
  },
  ip: {
    table: "IpVector",
    catalog: "AssetIp",
    identity: "assetIpId",
    image: "assetIpImageId",
    columns: ["ipTypeId", "matchPattern", "partialMatchPatternName"],
  },
} as const;

/** Aggregate all valid references per identity before thresholding and limiting candidates. */
export async function queryReferenceCandidates({
  kind,
  teamId,
  vector,
  limit,
  scoreThreshold,
  sourceType,
}: {
  kind: keyof typeof LIBRARIES;
  teamId: number;
  vector: number[];
  limit: number;
  scoreThreshold?: number;
  sourceType?: "image" | "description";
}): Promise<VectorQueryResult[]> {
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Reference embedding must contain finite numeric values");
  }
  const { table, catalog, identity, image, columns } = LIBRARIES[kind];
  const query = `
    WITH "referenceScores" AS MATERIALIZED (
      SELECT v."id", v."${identity}", v."${image}", v."sourceType",
        ${columns.map((column) => `v."${column}"`).join(", ")},
        c."referenceMatchStrategy",
        1 - (v."embedding" <=> $2::vector) AS "pointSimilarity"
      FROM "${table}" v
      INNER JOIN "${catalog}" c ON c."id" = v."${identity}" AND c."teamId" = v."teamId"
      WHERE v."teamId" = $1 AND v."enabled" = true AND v."status" = 'completed'
        AND c."enabled" = true AND c."status" = 'completed'
        AND ($3::text IS NULL OR v."sourceType" = $3)
    ),
    "classScores" AS (
      SELECT "${identity}", "sourceType", "referenceMatchStrategy",
        CASE WHEN "sourceType" = 'image' AND "referenceMatchStrategy" = 'average'
          THEN AVG("pointSimilarity") ELSE MAX("pointSimilarity") END AS "similarity",
        (ARRAY_AGG("id" ORDER BY "pointSimilarity" DESC, "id" ASC))[1] AS "matchedPointId"
      FROM "referenceScores"
      GROUP BY "${identity}", "sourceType", "referenceMatchStrategy"
    )
    SELECT r.*, s."similarity"
    FROM "classScores" s
    INNER JOIN "referenceScores" r ON r."id" = s."matchedPointId"
    WHERE $4::double precision IS NULL OR s."similarity" >= $4
    ORDER BY s."similarity" DESC, s."${identity}" ASC, s."sourceType" ASC
    LIMIT $5
  `;
  const rows = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown> & { id: string; similarity: number }>
  >(query, teamId, `[${vector.join(",")}]`, sourceType ?? null, scoreThreshold ?? null, limit);
  return rows.map(({ similarity, pointSimilarity: _pointSimilarity, ...payload }) => ({
    id: payload.id,
    score: Number(similarity),
    payload: { ...payload, teamId, enabled: true, status: "completed" },
  }));
}
