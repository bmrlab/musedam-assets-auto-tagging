import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translateTextToEnglish } from "@/lib/translation/service";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "gateway-key");
  vi.stubEnv("TRANSLATION_SERVICE_MODEL", "qwen-mt-flash");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("translation gateway", () => {
  it.each(["https://gateway.example/unified/v1", "https://gateway.example/unified/v1/"])(
    "uses the shared gateway configuration with base URL %s",
    async (baseUrl) => {
      vi.stubEnv("OPENAI_BASE_URL", baseUrl);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: " Coffee cup " } }] }),
      });

      await expect(translateTextToEnglish(" 咖啡杯 ")).resolves.toBe("Coffee cup");
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        "https://gateway.example/unified/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer gateway-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen-mt-flash",
            messages: [{ role: "user", content: "咖啡杯" }],
            translation_options: { source_lang: "auto", target_lang: "English" },
          }),
        },
      );
    },
  );

  it.each(["OPENAI_BASE_URL", "OPENAI_API_KEY"])(
    "requires %s before making a request",
    async (name) => {
      vi.stubEnv("OPENAI_BASE_URL", "https://gateway.example/v1");
      vi.stubEnv(name, "");

      await expect(translateTextToEnglish("咖啡杯")).rejects.toThrow(
        `Missing required env: ${name}`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
