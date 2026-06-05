import "server-only";

import prisma from "@/prisma/prisma";

// Convert a float array to a pgvector literal string: '[a,b,c]'::vector
function vectorToSql(vector: number[]): string {
  return `'[${vector.join(",")}]'::vector`;
}

export type VectorQueryResult = {
  id: string;
  score: number;
  payload: Record<string, unknown>;
};

/**
 * Query similar vectors using cosine distance
 * Filters should be in the format: "columnName = $N" with proper parameter index
 */
export async function querySimilarVectors(
  tableName: string,
  options: {
    vector: number[];
    limit: number;
    scoreThreshold?: number;
    whereClause: string;
    params: (string | number | boolean | null | undefined)[];
    /** Columns to select (excluding the embedding vector column) */
    columns: string[];
  },
): Promise<VectorQueryResult[]> {
  const { vector, limit, scoreThreshold, whereClause, params, columns } = options;

  const scoreCheck = scoreThreshold !== undefined ? `AND (1 - (embedding <=> ${vectorToSql(vector)})) >= ${scoreThreshold}` : "";

  // Use 1 - cosine distance as similarity score (cosine similarity)
  // Note: We explicitly select columns (excluding raw embedding vector) to avoid
  // Prisma deserialization error for the vector type (marked as Unsupported in schema).
  // The actual embedding vector is not needed in query results.
  const quotedColumns = columns.map((c) => `"${c}"`).join(", ");
  const query = `
    SELECT 
      ${quotedColumns},
      1 - (embedding <=> ${vectorToSql(vector)}) as similarity
    FROM "${tableName}"
    WHERE ${whereClause}
    ${scoreCheck}
    ORDER BY embedding <=> ${vectorToSql(vector)}
    LIMIT ${limit}
  `;

  const result = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown> & { similarity: number }>
  >(query, ...params);

  return result.map((row) => {
    const { similarity, ...payloadFields } = row;
    return {
      id: row.id as string,
      score: similarity,
      payload: payloadFields as Record<string, unknown>,
    };
  });
}

/**
 * Delete points by filter conditions
 */
export async function deletePointsByFilter(
  tableName: string,
  whereClause: string,
  params: (string | number | boolean | null | undefined)[],
): Promise<void> {
  const query = `DELETE FROM "${tableName}" WHERE ${whereClause}`;
  await prisma.$executeRawUnsafe(query, ...params);
}

/**
 * Execute a raw update query
 */
export async function executeRawUpdate(
  query: string,
  params: (string | number | boolean | null | undefined)[],
): Promise<void> {
  await prisma.$executeRawUnsafe(query, ...params);
}

/**
 * Execute a raw insert query with conflict handling
 */
export async function executeRawInsert(
  query: string,
  params: (string | number | boolean | null | undefined)[],
): Promise<void> {
  await prisma.$executeRawUnsafe(query, ...params);
}
