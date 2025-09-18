import { slugToId } from "@/lib/slug";
import { exchangeMuseDAMTeamAPIKey, retrieveTeamCredentials } from "@/musedam/apiKey";
import { syncAssetsFromMuseDAM, syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { MuseDAMID } from "@/musedam/types";
import { Team } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { loadEnvConfig } from "@next/env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_TEAM_SLUG = "t/135";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  // 加载 .env 文件
  loadEnvConfig(process.cwd());
  expect(process.env.MUSEDAM_APP_API_KEY).toBeDefined();
  expect(process.env.MUSEDAM_APP_SECRET).toBeDefined();
});

describe("MuseDAM API - Test environment", () => {
  let team: Team;

  beforeEach(async () => {
    const teamOrNull = await prisma.team.findUnique({ where: { slug: TEST_TEAM_SLUG } });
    expect(teamOrNull).not.toBeNull();
    team = teamOrNull!;
  });

  it("should exchange API key successfully", async () => {
    const musedamTeamId = slugToId("team", TEST_TEAM_SLUG);
    const result = await exchangeMuseDAMTeamAPIKey({ musedamTeamId });
    expect(result.apiKey).toBeDefined();
  });

  it("should retrieve team credentials successfully", async () => {
    const config = await retrieveTeamCredentials({ team });
    expect(config.apiKey).toBeDefined();
    expect(config.expiresAt).toBeDefined();
  });

  it("should query tag tree successfully", async () => {
    const promise = syncTagsFromMuseDAM({ team });
    await expect(promise).resolves.not.toThrow();
  }, 30000);

  it("should query assets successfully", async () => {
    const promise = syncAssetsFromMuseDAM({
      team,
      musedamFolderId: MuseDAMID.from(29669),
    });
    await expect(promise).resolves.not.toThrow();
  }, 30000);

  it("should query single asset successfully", async () => {
    const promise = syncSingleAssetFromMuseDAM({
      team,
      musedamAssetId: MuseDAMID.from(6908636),
    });
    await expect(promise).resolves.not.toThrow();
  }, 30000);
});
