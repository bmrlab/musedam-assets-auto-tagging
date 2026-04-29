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

export type PersonVectorPayload = {
  teamId: number;
  assetPersonId: string;
  assetPersonImageId: string;
  personTypeId: string | null;
  enabled: boolean;
  status: "pending" | "processing" | "completed" | "failed";
};

export type QdrantPersonQueryPoint = {
  id: string | number;
  score: number;
  payload?: Partial<PersonVectorPayload>;
};

function getPersonQdrantCollectionName() {
  return `${getQdrantConfig().collectionBaseName}_asset_person`;
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

export async function ensurePersonVectorCollection(vectorSize: number) {
  const collectionName = getPersonQdrantCollectionName();

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

export async function deletePersonVectorPointsByPerson({
  teamId,
  assetPersonId,
}: {
  teamId: number;
  assetPersonId: string;
}) {
  const collectionName = getPersonQdrantCollectionName();

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
            key: "assetPersonId",
            match: { value: assetPersonId },
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

export async function setPersonVectorPayloadByPerson({
  teamId,
  assetPersonId,
  payload,
}: {
  teamId: number;
  assetPersonId: string;
  payload: Partial<PersonVectorPayload>;
}) {
  const collectionName = getPersonQdrantCollectionName();

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
            key: "assetPersonId",
            match: { value: assetPersonId },
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

export async function upsertPersonVectorPoints(
  points: Array<{
    id: string;
    vector: number[];
    payload: PersonVectorPayload;
  }>,
) {
  if (points.length === 0) {
    return;
  }

  const collectionName = getPersonQdrantCollectionName();

  await qdrantRequest({
    path: `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
    method: "PUT",
    body: {
      points,
    },
  });
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
}) {
  const collectionName = getPersonQdrantCollectionName();

  try {
    const result = await qdrantRequest<{ points: QdrantPersonQueryPoint[] }>({
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
