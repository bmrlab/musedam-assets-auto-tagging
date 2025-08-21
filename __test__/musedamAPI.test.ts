import { slugToId } from "@/lib/slug";
import { exchangeMuseDAMTeamAPIKey } from "@/musedam/apiKey";
import { loadEnvConfig } from "@next/env";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  // 加载 .env 文件
  loadEnvConfig(process.cwd());
});

describe("MuseDAM API - Test environment", () => {
  it("should exchange API key successfully", async () => {
    const teamSlug = "t/135";
    const musedamTeamId = slugToId("team", teamSlug);
    const result = await exchangeMuseDAMTeamAPIKey({ musedamTeamId });
    expect(result.apiKey).toBeDefined();
  });
});
