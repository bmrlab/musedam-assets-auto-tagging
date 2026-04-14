import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
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

  for (let start = 0; start < images.length; start += config.batchSize) {
    const batch = images.slice(start, start + config.batchSize);
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
        new Error(
          `Jina embeddings request failed after ${JINA_MAX_RETRIES} attempts`,
        )
      );
    }

    const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
    embeddings.push(...sorted.map((item) => item.embedding));
  }

  return embeddings;
}
