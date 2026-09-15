import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
import { REFERENCE_IMAGE_PREPARATION_CONCURRENCY } from "@/lib/brand/upload-constants";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
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

const JINA_MAX_RETRIES = 5;
const JINA_RETRY_BASE_DELAY_MS = 500;
const JINA_MAX_IMAGE_BATCH_SIZE = 4;
const JINA_REQUEST_INTERVAL_MS = 2_500;
const JINA_RATE_LIMIT_RETRY_DELAY_MS = 60_000;
const jinaRequestLimit = pLimit(1);
let nextJinaRequestAt = 0;

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

function getRetryAfterMs(response: Awaited<ReturnType<typeof nodeFetch>>) {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

async function sendJinaEmbeddingRequest({
  config,
  body,
  proxyAgent,
}: {
  config: ReturnType<typeof getJinaConfig>;
  body: Record<string, unknown>;
  proxyAgent: ProxyAgent | undefined;
}) {
  return jinaRequestLimit(async () => {
    const queueDelayMs = Math.max(0, nextJinaRequestAt - Date.now());
    if (queueDelayMs > 0) {
      await sleep(queueDelayMs);
    }

    try {
      const response = await nodeFetch(config.embeddingsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
        dispatcher: proxyAgent,
      });
      const payload = (await response.json().catch(() => null)) as JinaResponse | null;
      const nextDelayMs =
        response.status === 429
          ? (getRetryAfterMs(response) ?? JINA_RATE_LIMIT_RETRY_DELAY_MS)
          : config.isDirectJina
            ? JINA_REQUEST_INTERVAL_MS
            : 0;

      nextJinaRequestAt = Math.max(nextJinaRequestAt, Date.now() + nextDelayMs);
      return { response, payload };
    } catch (error) {
      if (config.isDirectJina) {
        nextJinaRequestAt = Math.max(nextJinaRequestAt, Date.now() + JINA_REQUEST_INTERVAL_MS);
      }
      throw error;
    }
  });
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
  const proxyAgent = config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;
  const imageBatchSize = Math.min(config.batchSize, JINA_MAX_IMAGE_BATCH_SIZE);
  const prepareImage = pLimit(REFERENCE_IMAGE_PREPARATION_CONCURRENCY);

  for (let start = 0; start < images.length; start += imageBatchSize) {
    const batch = await Promise.all(
      images
        .slice(start, start + imageBatchSize)
        .map((image) => prepareImage(() => prepareJinaImageDataUrl(image))),
    );
    let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
    let payload: JinaResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt += 1) {
      try {
        const result = await sendJinaEmbeddingRequest({
          config,
          proxyAgent,
          body: {
            model: config.model,
            ...(task ? { task } : {}),
            input: batch.map((image) => ({ image })),
          },
        });
        response = result.response;
        payload = result.payload;

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
        lastError ?? new Error(`Jina embeddings request failed after ${JINA_MAX_RETRIES} attempts`)
      );
    }

    const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
    embeddings.push(...sorted.map((item) => item.embedding));
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
  const proxyAgent = config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;

  for (let start = 0; start < texts.length; start += config.batchSize) {
    const batch = texts.slice(start, start + config.batchSize);
    let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
    let payload: JinaResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= JINA_MAX_RETRIES; attempt += 1) {
      try {
        const result = await sendJinaEmbeddingRequest({
          config,
          proxyAgent,
          body: {
            model: config.model,
            ...(task ? { task } : {}),
            input: batch,
          },
        });
        response = result.response;
        payload = result.payload;

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
        lastError ?? new Error(`Jina embeddings request failed after ${JINA_MAX_RETRIES} attempts`)
      );
    }

    const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
    embeddings.push(...sorted.map((item) => item.embedding));
  }

  return embeddings;
}
