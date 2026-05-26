import "server-only";

import { getQdrantConfig } from "@/lib/brand/env";

type QdrantMatchCondition = {
  key: string;
  match: {
    value: boolean | number | string;
  };
};

type QdrantFilter = {
  must: QdrantMatchCondition[];
};

type QdrantStatus = {
  error?: string;
};

type QdrantResponse<T> = {
  status?: string | QdrantStatus;
  result?: T;
};

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

export type QdrantProductQueryPoint = {
  id: string | number;
  score: number;
  payload?: Partial<ProductVectorPayload>;
};

function getProductQdrantCollectionName() {
  return `${getQdrantConfig().collectionBaseName}_asset_product`;
}

function buildFilter(must: QdrantMatchCondition[]): QdrantFilter {
  return { must };
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("404");
}

async function qdrantRequest<T>({
  path,
  method = "GET",
  body,
}: {
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}) {
  const config = getQdrantConfig();
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      ...(config.apiKey ? { "api-key": config.apiKey } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = (await response.json().catch(() => null)) as QdrantResponse<T> | null;
  if (!response.ok) {
    const status = payload?.status;
    const errorDetails =
      typeof status === "object" && status?.error
        ? status.error
        : JSON.stringify(payload);
    throw new Error(
      `Qdrant request failed (${response.status}) for ${path}: ${errorDetails}`,
    );
  }

  return payload?.result as T;
}

export async function ensureProductVectorCollection(vectorSize: number) {
  const collectionName = getProductQdrantCollectionName();

  try {
    await qdrantRequest({
      path: `/collections/${encodeURIComponent(collectionName)}`,
    });
    return;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await qdrantRequest({
    path: `/collections/${encodeURIComponent(collectionName)}`,
    method: "PUT",
    body: {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    },
  });
}

export async function deleteProductVectorPointsByProduct({
  teamId,
  assetProductId,
}: {
  teamId: number;
  assetProductId: string;
}) {
  const collectionName = getProductQdrantCollectionName();

  try {
    await qdrantRequest({
      path: `/collections/${encodeURIComponent(collectionName)}/points/delete?wait=true`,
      method: "POST",
      body: {
        filter: buildFilter([
          {
            key: "teamId",
            match: { value: teamId },
          },
          {
            key: "assetProductId",
            match: { value: assetProductId },
          },
        ]),
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function setProductVectorPayloadByProduct({
  teamId,
  assetProductId,
  payload,
}: {
  teamId: number;
  assetProductId: string;
  payload: Partial<ProductVectorPayload>;
}) {
  const collectionName = getProductQdrantCollectionName();

  try {
    await qdrantRequest({
      path: `/collections/${encodeURIComponent(collectionName)}/points/payload?wait=true`,
      method: "POST",
      body: {
        filter: buildFilter([
          {
            key: "teamId",
            match: { value: teamId },
          },
          {
            key: "assetProductId",
            match: { value: assetProductId },
          },
        ]),
        payload,
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function upsertProductVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: ProductVectorPayload;
  }>,
) {
  if (points.length === 0) {
    return;
  }

  const collectionName = getProductQdrantCollectionName();

  await qdrantRequest({
    path: `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
    method: "PUT",
    body: {
      points,
    },
  });
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
}) {
  const collectionName = getProductQdrantCollectionName();
  const filterConditions: QdrantMatchCondition[] = [
    {
      key: "teamId",
      match: { value: teamId },
    },
    {
      key: "enabled",
      match: { value: true },
    },
    {
      key: "status",
      match: { value: "completed" },
    },
  ];

  if (sourceType) {
    filterConditions.push({
      key: "sourceType",
      match: { value: sourceType },
    });
  }

  try {
    const result = await qdrantRequest<{ points: QdrantProductQueryPoint[] }>({
      path: `/collections/${encodeURIComponent(collectionName)}/points/query`,
      method: "POST",
      body: {
        query: vector,
        limit,
        with_payload: true,
        score_threshold: scoreThreshold,
        filter: buildFilter(filterConditions),
      },
    });

    return result?.points ?? [];
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}
