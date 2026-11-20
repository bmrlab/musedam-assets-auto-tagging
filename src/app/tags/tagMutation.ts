import "server-only";

import type { ServerActionResult } from "@/lib/serverAction";
import { assertTagImportOwnership, runTagImportExclusive } from "@/lib/tagging/tag-import-lock";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import prisma from "@/prisma/prisma";
import { AsyncLocalStorage } from "node:async_hooks";
import { withTagManagementAuth } from "./tagManagementAuth";

const KEY = "tag-mutation-pending";
type Team = { id: number; slug: string };
const active = new AsyncLocalStorage<number>();

export function isTagMutationActive(teamId: number) {
  return active.getStore() === teamId;
}

async function recover(team: Team) {
  const where = { teamId_key: { teamId: team.id, key: KEY } };
  if (!(await prisma.teamConfig.findUnique({ where }))) return;
  // 主站为标签身份、名称、顺序的权威源；已有同步器保留本地 ID、AI 配置及关联。
  await syncTagsFromMuseDAM({ team });
  await clearPending(team);
}

async function clearPending(team: Team) {
  await prisma.$transaction(async (tx) => {
    await assertTagImportOwnership(tx);
    await tx.teamConfig.deleteMany({ where: { teamId: team.id, key: KEY } });
  });
}

/** 在读取或下一次写入前恢复崩溃、超时及本地落库失败留下的操作。失败不展示旧树为已同步。 */
export async function ensureTagMutationRecovered(team: Team, userId: number) {
  if (active.getStore() === team.id) return;
  if (
    !(await prisma.teamConfig.findUnique({ where: { teamId_key: { teamId: team.id, key: KEY } } }))
  )
    return;
  await runTagImportExclusive(team.id, userId, () => recover(team));
}

type AuthContext = Parameters<Parameters<typeof withTagManagementAuth>[0]>[0];

export async function withTagMutation<T>(
  action: (context: AuthContext) => Promise<ServerActionResult<T>>,
): Promise<ServerActionResult<T>> {
  return withTagManagementAuth(async (context) => {
    const { team, user } = context;
    if (active.getStore() === team.id) return action(context);
    try {
      return await runTagImportExclusive(team.id, user.id, () =>
        active.run(team.id, async () => {
          await recover(team);
          await prisma.$transaction(async (tx) => {
            await assertTagImportOwnership(tx);
            await tx.teamConfig.upsert({
              where: { teamId_key: { teamId: team.id, key: KEY } },
              create: { teamId: team.id, key: KEY, value: { pending: true } },
              update: { value: { pending: true } },
            });
          });
          let result: ServerActionResult<T>;
          try {
            result = await action(context);
          } catch (error) {
            await recover(team);
            throw error;
          }
          const partialFailure =
            result.success &&
            result.data &&
            typeof result.data === "object" &&
            "failedCount" in result.data &&
            Number(result.data.failedCount) > 0;
          if (!result.success || partialFailure) {
            await recover(team);
          } else {
            await clearPending(team);
          }
          return result;
        }),
      );
    } catch (error) {
      // 无法恢复时保留标记；下次读取/写入先恢复，绝不将失败伪装成保存成功。
      return {
        success: false,
        message: error instanceof Error ? error.message : "标签保存或同步恢复失败，请稍后重试",
      };
    }
  });
}
