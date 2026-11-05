import type { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import "server-only";

const KEY = "tagging-config-version";
export async function getTagConfigVersion(teamId: number): Promise<string> {
  const row = await prisma.teamConfig.findUnique({
    where: { teamId_key: { teamId, key: KEY } },
    select: { value: true },
  });
  return String((row?.value as { version?: string } | null)?.version ?? "0");
}

/** 与修改配置的事务共同提交；各进程读到新版本后换整棵树及候选索引。 */
export async function bumpTagConfigVersion(tx: Prisma.TransactionClient, teamId: number) {
  await tx.$executeRaw`
    INSERT INTO "TeamConfig" ("teamId", "key", "value", "createdAt", "updatedAt")
    VALUES (${teamId}, ${KEY}, jsonb_build_object('version', 1), now(), now())
    ON CONFLICT ("teamId", "key") DO UPDATE
    SET "value" = jsonb_build_object('version', COALESCE(("TeamConfig"."value"->>'version')::bigint, 0) + 1), "updatedAt" = now()`;
}
