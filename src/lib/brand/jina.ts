import { runInAbortableSlot } from "@/lib/tagging/abortable-slot";
import {
  getQueueExecution,
  queueAbortSignal,
  queueSleep,
  throwIfQueueAborted,
} from "@/lib/tagging/queue-execution";
import "server-only";
import { getJinaCircuit, JinaUnavailableError } from "./jina-circuit";

import { startTrackedEmbeddingBatch } from "@/lib/brand/embedding-tracking";
import { getJinaConfig, isDebugPageEnabled } from "@/lib/brand/env";
import { REFERENCE_IMAGE_PREPARATION_CONCURRENCY } from "@/lib/brand/upload-constants";
import { buildJinaDebugImageObjectKey, signS3ObjectUrl, uploadS3Object } from "@/lib/s3";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import pLimit from "p-limit";
import { fetch as nodeFetch, ProxyAgent } from "undici";

type JinaEmbeddingRecord = {
  embedding: number[];
  index: number;
};

type JinaResponse = {
  data?: JinaEmbeddingRecord[];
  detail?: unknown;
  error?: { message?: string; type?: string; code?: string };
  request_id?: string;
};

const JINA_MAX_RETRIES = 5;
const JINA_RETRY_BASE_DELAY_MS = 500;
const JINA_MAX_IMAGE_BATCH_SIZE = 4;
const JINA_DEBUG_IMAGE_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
// A paid Jina key allows 2M TPM and each jina-clip-v2 input can use up to 8,192 tokens.
// Reserve only 80% so mixed image/text traffic has headroom without a fixed per-request delay.
const JINA_REQUEST_CONCURRENCY = 8;
const JINA_PAID_TOKENS_PER_MINUTE = 2_000_000;
const JINA_MAX_TOKENS_PER_INPUT = 8_192;
const JINA_RATE_LIMIT_TARGET_UTILIZATION = 0.8;
const JINA_RATE_LIMIT_RETRY_DELAY_MS = 15_000;
const jinaRequestConcurrencyLimit = pLimit(JINA_REQUEST_CONCURRENCY);
const jinaRequestPacingLimit = pLimit(1);
let nextJinaRequestAt = 0;

const sleep = queueSleep;

class JinaRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(`Jina embeddings request failed: ${message}`, options);
    this.name = "JinaRequestError";
  }
}

// Providers may echo request inputs in errors. Keep diagnostics bounded and omit image data.
function sanitizeDiagnostic(value: string) {
  return value.replace(/data:[^\s"'<>]+/gi, "[image data redacted]").slice(0, 4000);
}

function getErrorMessage(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : String(error);
}

function logRequestFailure(error: unknown, context: Record<string, unknown>, retry: boolean) {
  const diagnostic = {
    ...context,
    retry,
    message: sanitizeDiagnostic(getErrorMessage(error)),
    cause:
      error instanceof Error && error.cause instanceof Error
        ? sanitizeDiagnostic(error.cause.message)
        : undefined,
  };
  if (retry) console.warn("[Jina embeddings] Request failed; retrying", diagnostic);
  else console.error("[Jina embeddings] Request failed", diagnostic);
}

function shouldRetryJinaRequest(error: unknown) {
  if (error instanceof JinaRequestError) return error.retryable;
  if (error instanceof JinaUnavailableError) return false;
  const message = getErrorMessage(error);
  return (
    (error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "TimeoutError") ||
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
  const inputCount = Array.isArray(body.input) ? Math.max(1, body.input.length) : 1;
  const requestIntervalMs = config.isDirectJina
    ? Math.ceil(
        (inputCount * JINA_MAX_TOKENS_PER_INPUT * 60_000) /
          (JINA_PAID_TOKENS_PER_MINUTE * JINA_RATE_LIMIT_TARGET_UTILIZATION),
      )
    : 0;

  throwIfQueueAborted();
  if (getQueueExecution())
    getJinaCircuit(`${config.embeddingsUrl}:${config.model}`).assertAvailable();
  return runInAbortableSlot(jinaRequestConcurrencyLimit, async () => {
    throwIfQueueAborted();
    await runInAbortableSlot(jinaRequestPacingLimit, async () => {
      while (nextJinaRequestAt > Date.now()) {
        await sleep(nextJinaRequestAt - Date.now());
      }
      nextJinaRequestAt = Date.now() + requestIntervalMs;
    });

    throwIfQueueAborted();
    const finishCircuit = getQueueExecution()
      ? getJinaCircuit(`${config.embeddingsUrl}:${config.model}`).acquire()
      : undefined;
    try {
      const response = await nodeFetch(config.embeddingsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: queueAbortSignal(
          AbortSignal.timeout(
            getQueueExecution() ? Math.min(config.timeoutMs, 30_000) : config.timeoutMs,
          ),
        ),
        dispatcher: proxyAgent,
      });
      const rawBody = await response.text();
      let payload: JinaResponse | null = null;
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (parsed && typeof parsed === "object") payload = parsed as JinaResponse;
      } catch {
        // Preserve a bounded diagnostic for HTML/plain-text gateway failures below.
      }
      if (response.status === 429) {
        const retryDelayMs = getRetryAfterMs(response) ?? JINA_RATE_LIMIT_RETRY_DELAY_MS;
        nextJinaRequestAt = Math.max(nextJinaRequestAt, Date.now() + retryDelayMs);
      }
      const validData =
        Array.isArray(payload?.data) &&
        payload.data.length === inputCount &&
        payload.data.every(
          (item) =>
            item &&
            Number.isInteger(item.index) &&
            item.index >= 0 &&
            item.index < inputCount &&
            Array.isArray(item.embedding) &&
            item.embedding.length > 0 &&
            item.embedding.every(Number.isFinite),
        ) &&
        new Set(payload.data.map((item) => item.index)).size === inputCount;
      if (!response.ok || payload?.error || !validData) {
        const detail =
          payload?.error?.message ||
          (payload?.detail ? JSON.stringify(payload.detail) : undefined) ||
          (!response.ok ? rawBody : "Invalid embedding response: missing or malformed vectors");
        const requestId =
          payload?.request_id ||
          response.headers.get("x-request-id") ||
          response.headers.get("request-id");
        throw new JinaRequestError(
          sanitizeDiagnostic(
            [
              `HTTP ${response.status}`,
              payload?.error?.type,
              payload?.error?.code,
              requestId ? `request_id=${requestId}` : undefined,
              detail,
            ]
              .filter(Boolean)
              .join("; "),
          ),
          response.status === 429 || response.status >= 500,
        );
      }
      finishCircuit?.("success");
      return { response, payload };
    } catch (error) {
      let cancelled = false;
      try {
        throwIfQueueAborted();
      } catch {
        cancelled = true;
      }
      const rateLimited = error instanceof JinaRequestError && error.message.includes("HTTP 429");
      finishCircuit?.(
        !cancelled && !rateLimited && shouldRetryJinaRequest(error) ? "failure" : "ignore",
      );
      throw error;
    }
  });
}

async function logDebugJinaImage(image: string, index: number, task?: "retrieval.query") {
  const match = /^data:(image\/(?:jpeg|png));base64,([\s\S]+)$/.exec(image);
  if (!match) {
    // console.warn(`[Jina image debug] Image ${index + 1} is not a JPEG or PNG data URL`);
    return;
  }

  const contentType = match[1];
  const objectKey = buildJinaDebugImageObjectKey(contentType === "image/png" ? ".png" : ".jpg");
  try {
    await uploadS3Object({
      body: Buffer.from(match[2], "base64"),
      contentType,
      objectKey,
    });
    const { signedUrl } = signS3ObjectUrl({
      objectKey,
      expiresInSeconds: JINA_DEBUG_IMAGE_URL_TTL_SECONDS,
    });
    // console.info(`[Jina image debug] image ${index + 1}${task ? ` (${task})` : ""}: ${signedUrl}`);
    // console.info(`[Jina image debug] S3 object key: ${objectKey}`);
  } catch (error) {
    // console.warn(`[Jina image debug] Failed to upload image ${index + 1} to S3`, error);
  }
}

export async function createJinaImageEmbeddings({
  images,
  task,
  padToSquare = false,
}: {
  images: string[];
  task?: "retrieval.query";
  padToSquare?: boolean;
}) {
  if (images.length === 0) {
    return [];
  }

  const config = getJinaConfig();
  const maxAttempts = getQueueExecution() ? 2 : JINA_MAX_RETRIES;
  const embeddings: number[][] = [];
  const proxyAgent = config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;
  const imageBatchSize = Math.min(config.batchSize, JINA_MAX_IMAGE_BATCH_SIZE);
  const prepareImage = pLimit(REFERENCE_IMAGE_PREPARATION_CONCURRENCY);

  for (let start = 0; start < images.length; start += imageBatchSize) {
    const batch = await Promise.all(
      images.slice(start, start + imageBatchSize).map((image) =>
        prepareImage(() => {
          throwIfQueueAborted();
          return prepareJinaImageDataUrl(image, { padToSquare });
        }),
      ),
    );
    if (isDebugPageEnabled()) {
      await Promise.all(batch.map((image, index) => logDebugJinaImage(image, start + index, task)));
    }
    const finishBatch = startTrackedEmbeddingBatch(batch.length);
    let generated = 0;
    try {
      let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
      let payload: JinaResponse | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

          break;
        } catch (error) {
          const retry = shouldRetryJinaRequest(error) && attempt < maxAttempts;
          const failure =
            error instanceof JinaRequestError
              ? error
              : new JinaRequestError(sanitizeDiagnostic(getErrorMessage(error)), retry, {
                  cause: error,
                });
          logRequestFailure(
            failure,
            {
              endpoint:
                new URL(config.embeddingsUrl).origin + new URL(config.embeddingsUrl).pathname,
              model: config.model,
              inputType: "image",
              batchStart: start,
              inputCount: batch.length,
              attempt,
              maxAttempts,
              timeoutMs: getQueueExecution()
                ? Math.min(config.timeoutMs, 30_000)
                : config.timeoutMs,
            },
            retry,
          );
          throwIfQueueAborted();
          if (!retry) {
            if (
              getQueueExecution() &&
              (shouldRetryJinaRequest(error) || error instanceof JinaUnavailableError)
            )
              throw new JinaUnavailableError(getErrorMessage(error), { cause: error });
            throw failure;
          }
          lastError = failure;
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
      generated = sorted.length;
    } finally {
      finishBatch?.(generated);
    }
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
  const maxAttempts = getQueueExecution() ? 2 : JINA_MAX_RETRIES;
  const embeddings: number[][] = [];
  const proxyAgent = config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;

  for (let start = 0; start < texts.length; start += config.batchSize) {
    const batch = texts.slice(start, start + config.batchSize);
    let response: Awaited<ReturnType<typeof nodeFetch>> | null = null;
    let payload: JinaResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

        break;
      } catch (error) {
        const retry = shouldRetryJinaRequest(error) && attempt < maxAttempts;
        const failure =
          error instanceof JinaRequestError
            ? error
            : new JinaRequestError(sanitizeDiagnostic(getErrorMessage(error)), retry, {
                cause: error,
              });
        logRequestFailure(
          failure,
          {
            endpoint: new URL(config.embeddingsUrl).origin + new URL(config.embeddingsUrl).pathname,
            model: config.model,
            inputType: "text",
            batchStart: start,
            inputCount: batch.length,
            attempt,
            maxAttempts,
            timeoutMs: getQueueExecution() ? Math.min(config.timeoutMs, 30_000) : config.timeoutMs,
          },
          retry,
        );
        throwIfQueueAborted();
        if (!retry) {
          if (
            getQueueExecution() &&
            (shouldRetryJinaRequest(error) || error instanceof JinaUnavailableError)
          )
            throw new JinaUnavailableError(getErrorMessage(error), { cause: error });
          throw failure;
        }
        lastError = failure;
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
