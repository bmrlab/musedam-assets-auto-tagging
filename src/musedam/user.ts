import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";
import { MuseDAMID } from "./types";

export async function fetchMuseDAMUser({
  team,
  musedamUserId,
  timeoutMs,
}: {
  team: {
    id: number;
    slug: string;
  };
  musedamUserId: MuseDAMID;
  timeoutMs?: number;
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result: {
    realName: string;
    nickName: string;
    roleCode: "admin" | "content" | string;
    canManageTags?: boolean;
    departmentIds: MuseDAMID[];
    groupIds: MuseDAMID[];
  } = await requestMuseDAMAPI("/api/muse/org-member-info", {
    method: "POST",
    timeoutMs,
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      userId: musedamUserId,
    },
  });
  return {
    ...result,
    roleCode: (result.roleCode === "admin"
      ? "admin"
      : result.roleCode === "content"
        ? "content"
        : null) as "admin" | "content" | null,
  };
}
