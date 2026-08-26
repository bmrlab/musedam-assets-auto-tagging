import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/proxy/fetch", () => ({ proxiedFetch: vi.fn() }));

async function importProviderModule() {
  vi.resetModules();
  return await import("@/ai/provider");
}

describe("llm() gateway-only fallback (private deployment)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AWS_BEDROCK_ACCESS_KEY_ID;
    delete process.env.AZURE_EASTUS2_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear config error when no gateway and no cloud-provider keys are set", async () => {
    const { llm } = await importProviderModule();
    expect(() => llm("qwen3-vl-flash")).toThrow(/Missing model gateway config/);
    expect(() => llm("gpt-5")).toThrow(/Missing model gateway config/);
    expect(() => llm("claude-sonnet-4")).toThrow(/Missing model gateway config/);
  });

  it("falls back to the OpenAI-compatible gateway when only OPENAI_BASE_URL/KEY are set", async () => {
    process.env.OPENAI_BASE_URL = "https://gateway.example.com/v1";
    process.env.OPENAI_API_KEY = "test-key";
    const { llm } = await importProviderModule();
    expect(() => llm("qwen3-vl-flash")).not.toThrow();
    expect(() => llm("gpt-5")).not.toThrow();
    expect(() => llm("claude-sonnet-4")).not.toThrow();
  });
});
