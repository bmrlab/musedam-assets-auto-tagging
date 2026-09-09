import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/proxy/fetch", () => ({ proxiedFetch: vi.fn() }));

async function importProviderModule() {
  vi.resetModules();
  return await import("@/ai/provider");
}

describe("llm() provider selection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLM_PROVIDER;
    delete process.env.AWS_BEDROCK_ACCESS_KEY_ID;
    delete process.env.AZURE_EASTUS2_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error for an invalid LLM_PROVIDER value", async () => {
    process.env.LLM_PROVIDER = "bogus";
    const { llm } = await importProviderModule();
    expect(() => llm("gpt-5")).toThrow(/Invalid LLM_PROVIDER/);
  });

  describe("LLM_PROVIDER unset (backward-compatible default)", () => {
    it("throws a clear config error when no gateway and no cloud-provider keys are set", async () => {
      const { llm } = await importProviderModule();
      expect(() => llm("gpt-5")).toThrow(/Missing model gateway config/);
      expect(() => llm("claude-sonnet-4")).toThrow(/Missing model gateway config/);
      expect(() => llm("crr-g-flash-20260903")).toThrow(/Missing model gateway config/);
    });

    it("resolves via the gateway, sending the model name straight through, once OPENAI_BASE_URL/KEY are set", async () => {
      process.env.OPENAI_BASE_URL = "https://gateway.example.com/v1";
      process.env.OPENAI_API_KEY = "test-key";
      const { llm } = await importProviderModule();
      expect(() => llm("gpt-5")).not.toThrow();
      expect(() => llm("claude-sonnet-4")).not.toThrow();
      // An opaque gateway-native model id (e.g. a real CR alias) needs no extra mapping.
      expect(() => llm("crr-g-flash-20260903")).not.toThrow();
    });

    it("resolves gpt-5/claude via cloud when their cloud key is present, without touching the gateway", async () => {
      process.env.AZURE_EASTUS2_API_KEY = "test-azure-key";
      process.env.AWS_BEDROCK_ACCESS_KEY_ID = "test-bedrock-key";
      const { llm } = await importProviderModule();
      expect(() => llm("gpt-5")).not.toThrow();
      expect(() => llm("claude-sonnet-4")).not.toThrow();
    });
  });

  describe("LLM_PROVIDER=gateway", () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = "gateway";
    });

    it("uses the gateway even when cloud keys are present", async () => {
      process.env.AZURE_EASTUS2_API_KEY = "test-azure-key";
      process.env.AWS_BEDROCK_ACCESS_KEY_ID = "test-bedrock-key";
      process.env.OPENAI_BASE_URL = "https://gateway.example.com/v1";
      process.env.OPENAI_API_KEY = "test-key";
      const { llm } = await importProviderModule();
      expect(() => llm("gpt-5")).not.toThrow();
      expect(() => llm("claude-sonnet-4")).not.toThrow();
    });

    it("resolves an opaque gateway-native model id with no cloud mapping", async () => {
      process.env.OPENAI_BASE_URL = "https://gateway.example.com/v1";
      process.env.OPENAI_API_KEY = "test-key";
      const { llm } = await importProviderModule();
      expect(() => llm("crr-g-flash-20260903")).not.toThrow();
    });
  });

  describe("LLM_PROVIDER=cloud", () => {
    beforeEach(() => {
      process.env.LLM_PROVIDER = "cloud";
    });

    it("resolves gpt-5/claude models without needing any gateway env vars", async () => {
      const { llm } = await importProviderModule();
      expect(() => llm("gpt-5")).not.toThrow();
      expect(() => llm("claude-sonnet-4")).not.toThrow();
    });

    it("throws for an opaque gateway-native model id, which has no cloud mapping", async () => {
      const { llm } = await importProviderModule();
      expect(() => llm("crr-g-flash-20260903")).toThrow(/no LLM_PROVIDER=cloud mapping/);
    });
  });
});
