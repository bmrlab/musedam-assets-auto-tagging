import "server-only";

import { getLLMProviderOverride } from "@/ai/provider";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

function getNumberEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric env: ${name}`);
  }

  return parsed;
}

function getBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean env: ${name}`);
}

// LLM_PROVIDER=gateway routes embeddings through OPENAI_BASE_URL/OPENAI_API_KEY too — the
// gateway's /unified/v1/embeddings (e.g. CR's) accepts the same Jina-shaped request/response
// fields (task, normalized, data[].embedding — see
// https://creative-reasoning.com/docs/zh/api-reference), so no separate mapping var is needed:
// JINA_EMBEDDING_MODEL just holds that gateway's own model code directly. Its vectors won't
// match jina-clip-v2's, so switching requires reindexing existing embeddings. LLM_PROVIDER
// unset/"cloud" keeps calling Jina directly, unaffected.
export function getJinaConfig() {
  if (getLLMProviderOverride() === "gateway") {
    return {
      apiKey: getRequiredEnv("OPENAI_API_KEY"),
      embeddingsUrl: `${getRequiredEnv("OPENAI_BASE_URL").replace(/\/$/, "")}/embeddings`,
      model: getRequiredEnv("JINA_EMBEDDING_MODEL"),
      batchSize: getNumberEnv("JINA_BATCH_SIZE", 4),
      timeoutMs: getNumberEnv("JINA_TIMEOUT_SECONDS", 60) * 1000,
      useProxy: false,
      proxyUrl: "",
    };
  }

  const useProxy = getBooleanEnv("JINA_USE_PROXY", false);
  const proxyUrl =
    process.env.JINA_PROXY_URL?.trim() ||
    process.env.FETCH_HTTPS_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    "";

  if (useProxy && !proxyUrl) {
    throw new Error(
      "JINA_USE_PROXY=true requires one of JINA_PROXY_URL, FETCH_HTTPS_PROXY, HTTPS_PROXY, HTTP_PROXY, or ALL_PROXY",
    );
  }

  return {
    apiKey: getRequiredEnv("JINA_API_KEY"),
    embeddingsUrl: process.env.JINA_EMBEDDINGS_URL?.trim() || "https://api.jina.ai/v1/embeddings",
    model: process.env.JINA_EMBEDDING_MODEL?.trim() || "jina-clip-v2",
    batchSize: getNumberEnv("JINA_BATCH_SIZE", 4),
    timeoutMs: getNumberEnv("JINA_TIMEOUT_SECONDS", 60) * 1000,
    useProxy,
    proxyUrl,
  };
}

export function getLogoDetectionServerUrl() {
  return getRequiredEnv("LOGO_DETECTION_SERVER_URL").replace(/\/$/, "");
}

export function getLogoDetectionServerToken() {
  return getRequiredEnv("LOGO_DETECTION_SERVER_TOKEN");
}

export function isDebugPageEnabled() {
  return getBooleanEnv("DEBUG_PAGE", false);
}
