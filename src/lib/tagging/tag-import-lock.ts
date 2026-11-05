import { rootLogger } from "@/lib/logging";
import type { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import "server-only";

const KEY = "tag-tree-import-owner";
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 20_000;
type Context = { teamId: number; token: string; lost: boolean };
const context = new AsyncLocalStorage<Context>();
export class TagImportBusyError extends Error {
  constructor(public memberName: string) {
    super("Team tag import already running");
  }
}

/** 整次导入互斥，锁保存在现有 TeamConfig，跨请求/进程生效；不占用跨网络的数据库事务。 */
export async function runTagImportExclusive<T>(
  teamId: number,
  userId: number,
  run: () => Promise<T>,
): Promise<T> {
  // 先做不加锁的已提交快照读取，避免 B 的 UPSERT 等待 A 正在写入时持有的租约行锁。
  const running = await prisma.$queryRaw<
    Array<{ memberName: string }>
  >`SELECT "value"->>'memberName' AS "memberName"
    FROM "TeamConfig" WHERE "teamId" = ${teamId} AND "key" = ${KEY}
    AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000`;
  if (running.length) throw new TagImportBusyError(running[0].memberName);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, slug: true },
  });
  const memberName = user?.name?.trim() || user?.slug || String(userId);
  const token = randomUUID();
  const acquired = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "TeamConfig" ("teamId", "key", "value", "createdAt", "updatedAt")
    VALUES (${teamId}, ${KEY}, jsonb_build_object('token', ${token}::text, 'memberName', ${memberName}::text,
      'expiresAt', extract(epoch from clock_timestamp()) * 1000 + ${LEASE_MS}), now(), now())
    ON CONFLICT ("teamId", "key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE COALESCE(("TeamConfig"."value"->>'expiresAt')::numeric, 0) < extract(epoch from clock_timestamp()) * 1000
    RETURNING "id"`;
  if (!acquired.length) {
    const owner = await prisma.teamConfig.findUnique({
      where: { teamId_key: { teamId, key: KEY } },
      select: { value: true },
    });
    throw new TagImportBusyError(
      (owner?.value as { memberName?: string } | null)?.memberName || "未知",
    );
  }
  const state: Context = { teamId, token, lost: false };
  let renewal: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (renewal || state.lost) return;
    renewal = (async () => {
      try {
        const count = await prisma.$executeRaw`UPDATE "TeamConfig"
          SET "value" = jsonb_set("value", '{expiresAt}', to_jsonb(extract(epoch from clock_timestamp()) * 1000 + ${LEASE_MS})), "updatedAt" = now()
          WHERE "teamId" = ${teamId} AND "key" = ${KEY} AND "value"->>'token' = ${token}
          AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000`;
        if (!count) state.lost = true;
      } catch {
        state.lost = true;
      } finally {
        renewal = undefined;
      }
    })();
  }, HEARTBEAT_MS);
  heartbeat.unref();
  try {
    return await context.run(state, run);
  } finally {
    clearInterval(heartbeat);
    await renewal;
    // 只释放自己的锁；即使旧进程恢复，也不能释放已经接管的新持有者。
    try {
      await prisma.teamConfig.deleteMany({
        where: { teamId, key: KEY, value: { path: ["token"], equals: token } },
      });
    } catch (error) {
      rootLogger.warn({
        msg: "Could not release tag import lease; it will expire",
        teamId,
        error: String(error),
      });
    }
  }
}

/** 所有本地写入事务先检查持有者并锁定租约行，防止过期旧进程恢复后继续覆盖新导入。 */
export async function assertTagImportOwnership(tx: Prisma.TransactionClient) {
  const state = context.getStore();
  if (!state) return;
  if (state.lost) throw new Error("批量导入执行锁已失效，请刷新页面后重试。");
  const owner = await tx.$queryRaw<Array<{ id: number }>>`SELECT "id" FROM "TeamConfig"
    WHERE "teamId" = ${state.teamId} AND "key" = ${KEY} AND "value"->>'token' = ${state.token}
    AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000 FOR UPDATE`;
  if (!owner.length) {
    state.lost = true;
    throw new Error("批量导入执行锁已失效，请刷新页面后重试。");
  }
}
