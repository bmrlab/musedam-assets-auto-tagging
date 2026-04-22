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

type QdrantResponse<T> = {
  status?: string;
  result?: T;
};

export type IpVectorPayload = {
  teamId: number;
  assetIpId: string;
  assetIpImageId: string | null;
  ipTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  sourceType: "image" | "description";
};

export type QdrantIpQueryPoint = {
  id: string | number;
  score: number;
  payload?: Partial<IpVectorPayload>;
};

function getIpQdrantCollectionName() {
  return `${getQdrantConfig().collectionName}_asset_ip`;
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
    throw new Error(`Qdrant request failed (${response.status}) for ${path}`);
  }

  return payload?.result as T;
}

export async function ensureIpVectorCollection(vectorSize: number) {
  const collectionName = getIpQdrantCollectionName();

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

export async function deleteIpVectorPointsByIp({
  teamId,
  assetIpId,
}: {
  teamId: number;
  assetIpId: string;
}) {
  const collectionName = getIpQdrantCollectionName();

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
            key: "assetIpId",
            match: { value: assetIpId },
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

export async function setIpVectorPayloadByIp({
  teamId,
  assetIpId,
  payload,
}: {
  teamId: number;
  assetIpId: string;
  payload: Partial<IpVectorPayload>;
}) {
  const collectionName = getIpQdrantCollectionName();

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
            key: "assetIpId",
            match: { value: assetIpId },
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

export async function upsertIpVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: IpVectorPayload;
  }>,
) {
  if (points.length === 0) {
    return;
  }

  const collectionName = getIpQdrantCollectionName();

  await qdrantRequest({
    path: `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
    method: "PUT",
    body: {
      points,
    },
  });
}

export async function queryIpVectorPoints({
  teamId,
  vector,
  limit,
  scoreThreshold,
}: {
  teamId: number;
  vector: number[];
  limit: number;
  scoreThreshold?: number;
}) {
  const collectionName = getIpQdrantCollectionName();

  try {
    const result = await qdrantRequest<{ points: QdrantIpQueryPoint[] }>({
      path: `/collections/${encodeURIComponent(collectionName)}/points/query`,
      method: "POST",
      body: {
        query: vector,
        limit,
        with_payload: true,
        score_threshold: scoreThreshold,
        filter: buildFilter([
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
        ]),
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
