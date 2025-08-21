import { rootLogger } from "@/lib/logging";
import { slugToId } from "@/lib/slug";
import { Team } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { requestMuseDAMAPI } from "./lib";
import { TeamConfigName, TeamConfigValue } from "./types";

export async function exchangeMuseDAMTeamAPIKey({
  musedamTeamId,
}: {
  musedamTeamId: string;
}): Promise<{
  apiKey: string;
  expiresAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  org: any;
}> {
  const token: string = Buffer.from(
    `${process.env.MUSEDAM_APP_API_KEY}:${process.env.MUSEDAM_APP_SECRET}`,
  ).toString("base64");
  const result = await requestMuseDAMAPI("/api/apps/exchange-api-key", {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
    },
    body: {
      orgId: parseInt(musedamTeamId),
    },
  });
  return result;
}

export async function retrieveTeamCredentials({
  team,
}: {
  team: Pick<Team, "id" | "slug">;
}): Promise<TeamConfigValue<"musedamTeamApiKey">> {
  const existingConfig = await prisma.teamConfig.findUnique({
    where: {
      teamId_key: {
        teamId: team.id,
        key: TeamConfigName.musedamTeamApiKey,
      },
    },
  });
  if (existingConfig) {
    return existingConfig.value as TeamConfigValue<"musedamTeamApiKey">;
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
  return {
    apiKey: result.apiKey,
    expiresAt: result.expiresAt,
  };
}
