import "server-only";
import prisma from "@/prisma/prisma";
import type { Prisma } from "@/prisma/client";
import { CANCELLED_TASK_ERROR_CODE } from "@/app/(tagging)/queue-config";

// Independent of user-editable tagging settings. No process cache: all instances
// must observe an administrator's suspension on their next operation.
export const TEAM_TAGGING_SUSPENDED_KEY = "taggingSuspended";

export class TeamTaggingSuspendedError extends Error {
  readonly code = CANCELLED_TASK_ERROR_CODE;
  constructor() {
    super("TEAM_TAGGING_SUSPENDED");
  }
}

export async function isTeamTaggingSuspended(
  teamId: number,
  db: Pick<Prisma.TransactionClient, "teamConfig"> = prisma,
): Promise<boolean> {
  const config = await db.teamConfig.findUnique({
    where: { teamId_key: { teamId, key: TEAM_TAGGING_SUSPENDED_KEY } },
    select: { value: true },
  });
  return config?.value === true;
}

export async function assertTeamTaggingEnabled(
  teamId: number,
  db: Pick<Prisma.TransactionClient, "teamConfig"> = prisma,
): Promise<void> {
  if (await isTeamTaggingSuspended(teamId, db)) throw new TeamTaggingSuspendedError();
}
