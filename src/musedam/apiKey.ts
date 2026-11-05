import { rootLogger } from "@/lib/logging";
import { slugToId } from "@/lib/slug";
import { Team } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { requestMuseDAMAPI } from "./lib";
import { MuseDAMID, TeamConfigName, TeamConfigValue } from "./types";

interface CacheItem {
  value: TeamConfigValue<"musedamTeamApiKey">;
  expiresAt: Date;
}

const apiKeyCache = new Map<string, CacheItem>();

/** 每次发起打标实时检查应用授权和团队有效性，不能使用已缓存的团队凭据代替。 */
export async function assertTeamTaggingAuthorization(
  team: Pick<Team, "id" | "slug">,
): Promise<void> {
  if (!process.env.MUSEDAM_APP_API_KEY || !process.env.MUSEDAM_APP_SECRET) {
    throw new Error("MuseDAM application credentials are not configured");
  }
  // https://www.musedam.cc/zh-CN/developers/markdown/applications.md
  // exchange-api-key 会对未安装应用、团队不存在或已到期等情况返回业务错误。
  const result = await exchangeMuseDAMTeamAPIKey({ musedamTeamId: slugToId("team", team.slug) });
  if (
    typeof result?.apiKey !== "string" ||
    !result.apiKey.trim() ||
    typeof result?.expiresAt !== "string" ||
    !result.expiresAt.trim()
  ) {
    throw new Error("Invalid MuseDAM authorization response");
  }
}

export async function exchangeMuseDAMTeamAPIKey({
  musedamTeamId,
}: {
  musedamTeamId: MuseDAMID;
}): Promise<{
  apiKey: string;
  expiresAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org: any;
}> {
  const token: string = Buffer.from(
    `${process.env.MUSEDAM_APP_API_KEY}:${process.env.MUSEDAM_APP_SECRET}`,
  ).toString("base64");
  const result = await requestMuseDAMAPI<{
    apiKey: string;
    expiresAt: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    org: any;
  }>("/api/apps/exchange-api-key", {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
    },
    body: {
      orgId: musedamTeamId,
    },
  });
  return result;
}

export async function retrieveTeamCredentials({
  team,
}: {
  team: Pick<Team, "id" | "slug">;
}): Promise<TeamConfigValue<"musedamTeamApiKey">> {
  const cacheKey = `team_${team.id}`;

  // Check memory cache first
  const cachedItem = apiKeyCache.get(cacheKey);
  if (cachedItem && cachedItem.expiresAt > new Date()) {
    return cachedItem.value;
  }

  const existingConfig = await prisma.teamConfig.findUnique({
    where: {
      teamId_key: {
        teamId: team.id,
        key: TeamConfigName.musedamTeamApiKey,
      },
    },
  });
  if (existingConfig) {
    const value = existingConfig.value as TeamConfigValue<"musedamTeamApiKey">;
    // Cache for 1 hour
    apiKeyCache.set(cacheKey, {
      value,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return value;
  }
  const musedamTeamId = slugToId("team", team.slug);
  const result = await exchangeMuseDAMTeamAPIKey({ musedamTeamId });
  if (!result.apiKey || !result.expiresAt) {
    const msg = `Invalid API key or expiresAt received from MuseDAM exchange-api-key API`;
    rootLogger.error({ msg, teamId: team.id, teamSlug: team.slug, result });
    throw new Error(msg);
  }
  await prisma.teamConfig.create({
    data: {
      teamId: team.id,
      key: TeamConfigName.musedamTeamApiKey,
      value: result,
    },
  });

  const returnValue = {
    apiKey: result.apiKey,
    expiresAt: result.expiresAt,
  };

  // Cache for 1 hour
  apiKeyCache.set(cacheKey, {
    value: returnValue,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return returnValue;
}
