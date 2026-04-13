import "server-only";

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

export function getJinaConfig() {
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
    batchSize: getNumberEnv("JINA_BATCH_SIZE", 8),
    timeoutMs: getNumberEnv("JINA_TIMEOUT_SECONDS", 30) * 1000,
    useProxy,
    proxyUrl,
  };
}

export function getQdrantConfig() {
  return {
    url: getRequiredEnv("QDRANT_URL").replace(/\/$/, ""),
    apiKey: process.env.QDRANT_API_KEY?.trim() || "",
    collectionName: getRequiredEnv("QDRANT_COLLECTION_NAME"),
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
