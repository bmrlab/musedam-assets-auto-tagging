import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/proxy/fetch", () => ({ proxiedFetch: vi.fn() }));

async function importEnvModule() {
  vi.resetModules();
  return await import("@/lib/brand/env");
}

describe("getJinaConfig() LLM_PROVIDER routing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.JINA_API_KEY;
    delete process.env.JINA_EMBEDDINGS_URL;
    delete process.env.JINA_EMBEDDING_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("calls Jina directly when LLM_PROVIDER is unset, defaulting url/model", async () => {
    process.env.JINA_API_KEY = "test-jina-key";
    const { getJinaConfig } = await importEnvModule();
    const config = getJinaConfig();
    expect(config.apiKey).toBe("test-jina-key");
    expect(config.embeddingsUrl).toBe("https://api.jina.ai/v1/embeddings");
    expect(config.model).toBe("jina-clip-v2");
  });

  it("throws when LLM_PROVIDER=gateway but OPENAI_BASE_URL/KEY are not set", async () => {
    process.env.LLM_PROVIDER = "gateway";
    process.env.JINA_EMBEDDING_MODEL = "crr-d-vl-embedding-20260107";
    const { getJinaConfig } = await importEnvModule();
    expect(() => getJinaConfig()).toThrow(/Missing required env: OPENAI_API_KEY/);
  });

  it("throws when LLM_PROVIDER=gateway but JINA_EMBEDDING_MODEL is not set", async () => {
    process.env.LLM_PROVIDER = "gateway";
    process.env.OPENAI_BASE_URL = "https://gateway.example.com/unified/v1";
    process.env.OPENAI_API_KEY = "test-key";
    const { getJinaConfig } = await importEnvModule();
    expect(() => getJinaConfig()).toThrow(/Missing required env: JINA_EMBEDDING_MODEL/);
  });

  it("routes through the gateway when LLM_PROVIDER=gateway is fully configured, no separate JINA_API_KEY needed", async () => {
    process.env.LLM_PROVIDER = "gateway";
    process.env.OPENAI_BASE_URL = "https://gateway.example.com/unified/v1";
    process.env.OPENAI_API_KEY = "test-key";
    process.env.JINA_EMBEDDING_MODEL = "crr-d-vl-embedding-20260107";
    const { getJinaConfig } = await importEnvModule();
    const config = getJinaConfig();
    expect(config.apiKey).toBe("test-key");
    expect(config.embeddingsUrl).toBe("https://gateway.example.com/unified/v1/embeddings");
    expect(config.model).toBe("crr-d-vl-embedding-20260107");
  });
});
