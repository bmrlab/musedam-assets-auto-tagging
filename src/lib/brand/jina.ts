import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
import { REFERENCE_IMAGE_PREPARATION_CONCURRENCY } from "@/lib/brand/upload-constants";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import { InvokeEndpointCommand, SageMakerRuntimeClient } from "@aws-sdk/client-sagemaker-runtime";
import pLimit from "p-limit";
import { ProxyAgent, fetch as nodeFetch } from "undici";

type JinaEmbeddingRecord = {
  embedding: number[];
  index: number;
};

type JinaResponse = {
  data?: JinaEmbeddingRecord[];
  detail?: string;
};

type SageMakerEmbeddingInput = {
  bytes?: string;
  text?: string;
};

const JINA_MAX_RETRIES = 5;
const JINA_RETRY_BASE_DELAY_MS = 500;
const JINA_MAX_IMAGE_BATCH_SIZE = 4;
const JINA_EMBEDDING_DIMENSIONS = "1024";

type MainlandJinaConfig = Extract<ReturnType<typeof getJinaConfig>, { isGlobal: false }>;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryJinaRequest(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("fetch failed") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND")
  );
}

function createSageMakerClient(config: MainlandJinaConfig) {
  return new SageMakerRuntimeClient({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
    maxAttempts: JINA_MAX_RETRIES,
    region: config.region,
  });
}

function dataUrlToBase64(image: string) {
  const match = image.match(/^data:[^;]+;base64,([\s\S]+)$/);
  if (!match) {
    throw new Error("Jina SageMaker image input must be a base64 data URL");
  }

  return match[1];
}

function getResponseDetail(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const detail = record.detail ?? record.error ?? record.message;
  return typeof detail === "string" && detail ? `: ${detail}` : "";
}

function getEmbeddingRecords(payload: unknown): JinaEmbeddingRecord[] | null {
  let data: unknown = payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    data = (payload as Record<string, unknown>).data;

    if (data && typeof data === "object" && !Array.isArray(data)) {
      data = (data as Record<string, unknown>).data;
    }
  }

  if (!Array.isArray(data)) {
    return null;
  }

  const records: JinaEmbeddingRecord[] = [];
  for (const [position, item] of data.entries()) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item : null;
    const embedding = record
      ? (record as Record<string, unknown>).embedding
      : Array.isArray(item)
        ? item
        : null;
    const index = record ? (record as Record<string, unknown>).index : position;

    if (
      !Array.isArray(embedding) ||
      !embedding.every((value) => typeof value === "number") ||
      (index !== undefined && typeof index !== "number")
    ) {
      return null;
    }

    records.push({
      embedding,
      index: typeof index === "number" ? index : position,
    });
  }

  return records;
}

async function invokeSageMakerEmbeddings({
  client,
  config,
  data,
  task,
}: {
  client: SageMakerRuntimeClient;
  config: MainlandJinaConfig;
  data: SageMakerEmbeddingInput[];
  task: "retrieval.passage" | "retrieval.query";
}) {
  const command = new InvokeEndpointCommand({
    Accept: "application/json",
    Body: JSON.stringify({
      data,
      parameters: {
        dimensions: JINA_EMBEDDING_DIMENSIONS,
        task,
      },
    }),
    ContentType: "application/json",
    EndpointName: config.endpointName,
  });

  try {
    const response = await client.send(command, {
      abortSignal: AbortSignal.timeout(config.timeoutMs),
    });
    const responseText = response.Body ? new TextDecoder().decode(response.Body) : "";
    const payload = responseText ? (JSON.parse(responseText) as unknown) : null;
    const records = getEmbeddingRecords(payload);

    if (!records) {
      throw new Error(`Invalid SageMaker response${getResponseDetail(payload)}`);
    }

    return records.slice().sort((left, right) => left.index - right.index);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Jina embeddings request failed via SageMaker: ${message}`, {
      cause: error,
    });
  }
}

export async function createJinaImageEmbeddings({
  images,
  task,
}: {
  images: string[];
  task?: "retrieval.query";
}) {
  if (images.length === 0) {
    return [];
  }

  const config = getJinaConfig();
  const embeddings: number[][] = [];
  const proxyAgent =
    config.isGlobal && config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;
  const imageBatchSize = Math.min(config.batchSize, JINA_MAX_IMAGE_BATCH_SIZE);
  const prepareImage = pLimit(REFERENCE_IMAGE_PREPARATION_CONCURRENCY);
  const sageMakerClient = config.isGlobal ? null : createSageMakerClient(config);

  try {
    for (let start = 0; start < images.length; start += imageBatchSize) {
      const batch = await Promise.all(
        images
          .slice(start, start + imageBatchSize)
          .map((image) => prepareImage(() => prepareJinaImageDataUrl(image))),
      );

      if (!config.isGlobal) {
        const records = await invokeSageMakerEmbeddings({
          client: sageMakerClient!,
          config,
          data: batch.map((image) => ({ bytes: dataUrlToBase64(image) })),
          task: task ?? "retrieval.passage",
        });
        embeddings.push(...records.map((item) => item.embedding));
        continue;
      }

      let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
      let payload: JinaResponse | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt += 1) {
        try {
          response = await nodeFetch(config.embeddingsUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              ...(task ? { task } : {}),
              input: batch.map((image) => ({ image })),
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
            dispatcher: proxyAgent,
          });

          payload = (await response.json().catch(() => null)) as JinaResponse | null;

          const retryableStatus = response.status >= 500 || response.status === 429;
          if (response.ok && payload?.data) {
            break;
          }

          const detail = payload?.detail ? `: ${payload.detail}` : "";
          const responseError = new Error(
            `Jina embeddings request failed (${response.status})${detail}`,
          );
          const isLastAttempt = attempt === JINA_MAX_RETRIES;

          if (!retryableStatus || isLastAttempt) {
            throw responseError;
          }

          lastError = responseError;
        } catch (error) {
          const isLastAttempt = attempt === JINA_MAX_RETRIES;
          if (!shouldRetryJinaRequest(error) || isLastAttempt) {
            throw error;
          }

          lastError = error;
        }

        const backoffMs = JINA_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }

      if (!response?.ok || !payload?.data) {
        throw (
          lastError ??
          new Error(`Jina embeddings request failed after ${JINA_MAX_RETRIES} attempts`)
        );
      }

      const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
      embeddings.push(...sorted.map((item) => item.embedding));
    }
  } finally {
    sageMakerClient?.destroy();
  }

  return embeddings;
}

export async function createJinaTextEmbeddings({
  texts,
  task,
}: {
  texts: string[];
  task?: "retrieval.query";
}) {
  if (texts.length === 0) {
    return [];
  }

  const config = getJinaConfig();
  const embeddings: number[][] = [];
  const proxyAgent =
    config.isGlobal && config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;
  const sageMakerClient = config.isGlobal ? null : createSageMakerClient(config);

  try {
    for (let start = 0; start < texts.length; start += config.batchSize) {
      const batch = texts.slice(start, start + config.batchSize);

      if (!config.isGlobal) {
        const records = await invokeSageMakerEmbeddings({
          client: sageMakerClient!,
          config,
          data: batch.map((text) => ({ text })),
          task: task ?? "retrieval.passage",
        });
        embeddings.push(...records.map((item) => item.embedding));
        continue;
      }

      let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
      let payload: JinaResponse | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt += 1) {
        try {
          response = await nodeFetch(config.embeddingsUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              ...(task ? { task } : {}),
              input: batch,
            }),
            signal: AbortSignal.timeout(config.timeoutMs),
            dispatcher: proxyAgent,
          });

          payload = (await response.json().catch(() => null)) as JinaResponse | null;

          const retryableStatus = response.status >= 500 || response.status === 429;
          if (response.ok && payload?.data) {
            break;
          }

          const detail = payload?.detail ? `: ${payload.detail}` : "";
          const responseError = new Error(
            `Jina embeddings request failed (${response.status})${detail}`,
          );
          const isLastAttempt = attempt === JINA_MAX_RETRIES;

          if (!retryableStatus || isLastAttempt) {
            throw responseError;
          }

          lastError = responseError;
        } catch (error) {
          const isLastAttempt = attempt === JINA_MAX_RETRIES;
          if (!shouldRetryJinaRequest(error) || isLastAttempt) {
            throw error;
          }

          lastError = error;
        }

        const backoffMs = JINA_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }

      if (!response?.ok || !payload?.data) {
        throw (
          lastError ??
          new Error(`Jina embeddings request failed after ${JINA_MAX_RETRIES} attempts`)
        );
      }

      const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
      embeddings.push(...sorted.map((item) => item.embedding));
    }
  } finally {
    sageMakerClient?.destroy();
  }

  return embeddings;
}
