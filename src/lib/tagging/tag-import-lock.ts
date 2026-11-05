import { rootLogger } from "@/lib/logging";
import type { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import "server-only";
import { runWithTagImportSignal } from "./tag-import-runtime";

const KEY = "tag-tree-import-owner";
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 20_000;
export const TAG_IMPORT_MAX_DURATION_MS = 10 * 60_000;
const CLEANUP_TIMEOUT_MS = 5_000;

export class TagImportTimeoutError extends Error {
  constructor() {
    super("本次标签导入已超时，请稍后重新导入；已提交的标签将按现有路径复用。");
  }
}

async function boundedCleanup(task: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Import lease cleanup timed out")), CLEANUP_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
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
    AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000
    AND COALESCE(("value"->>'deadlineAt')::numeric,
      extract(epoch from "createdAt") * 1000 + ${TAG_IMPORT_MAX_DURATION_MS}) > extract(epoch from clock_timestamp()) * 1000`;
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
      'expiresAt', extract(epoch from clock_timestamp()) * 1000 + ${LEASE_MS},
      'startedAt', extract(epoch from clock_timestamp()) * 1000,
      'deadlineAt', extract(epoch from clock_timestamp()) * 1000 + ${TAG_IMPORT_MAX_DURATION_MS}), now(), now())
    ON CONFLICT ("teamId", "key") DO UPDATE SET "value" = EXCLUDED."value", "createdAt" = now(), "updatedAt" = now()
    WHERE COALESCE(("TeamConfig"."value"->>'expiresAt')::numeric, 0) < extract(epoch from clock_timestamp()) * 1000
      OR COALESCE(("TeamConfig"."value"->>'deadlineAt')::numeric,
        extract(epoch from "TeamConfig"."createdAt") * 1000 + ${TAG_IMPORT_MAX_DURATION_MS}) <= extract(epoch from clock_timestamp()) * 1000
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
  const controller = new AbortController();
  const startedAt = Date.now();
  rootLogger.info({ msg: "Tag import started", teamId, userId });
  let renewal: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (renewal || state.lost) return;
    renewal = (async () => {
      try {
        const count = await prisma.$executeRaw`UPDATE "TeamConfig"
          SET "value" = jsonb_set("value", '{expiresAt}', to_jsonb(LEAST(extract(epoch from clock_timestamp()) * 1000 + ${LEASE_MS}, ("value"->>'deadlineAt')::numeric))), "updatedAt" = now()
          WHERE "teamId" = ${teamId} AND "key" = ${KEY} AND "value"->>'token' = ${token}
          AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000`;
        if (!count) {
          state.lost = true;
          controller.abort(new Error("批量导入执行锁已失效，请刷新页面后重试。"));
        }
      } catch {
        state.lost = true;
        controller.abort(new Error("批量导入执行锁续期失败，请稍后重试。"));
      } finally {
        renewal = undefined;
      }
    })();
  }, HEARTBEAT_MS);
  heartbeat.unref();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      state.lost = true;
      clearInterval(heartbeat);
      const error = new TagImportTimeoutError();
      controller.abort(error);
      rootLogger.warn({ msg: "Tag import exceeded maximum duration", teamId });
      reject(error);
    }, TAG_IMPORT_MAX_DURATION_MS);
    deadlineTimer.unref();
  });
  try {
    return await Promise.race([
      context.run(state, () => runWithTagImportSignal(controller.signal, run)),
      deadline,
    ]);
  } finally {
    clearTimeout(deadlineTimer);
    clearInterval(heartbeat);
    // 只释放自己的锁；即使旧进程恢复，也不能释放已经接管的新持有者。
    try {
      if (renewal) await boundedCleanup(renewal);
      await boundedCleanup(prisma.teamConfig.deleteMany({
        where: { teamId, key: KEY, value: { path: ["token"], equals: token } },
      }));
    } catch (error) {
      rootLogger.warn({
        msg: "Could not release tag import lease; it will expire",
        teamId,
        error: String(error),
      });
    }
    rootLogger.info({ msg: "Tag import stopped", teamId, elapsedMs: Date.now() - startedAt, leaseLost: state.lost });
  }
}

/** 所有本地写入事务先检查持有者并锁定租约行，防止过期旧进程恢复后继续覆盖新导入。 */
export async function assertTagImportOwnership(tx: Prisma.TransactionClient) {
  const state = context.getStore();
  if (!state) return;
  if (state.lost) throw new Error("批量导入执行锁已失效，请刷新页面后重试。");
  const owner = await tx.$queryRaw<Array<{ id: number }>>`SELECT "id" FROM "TeamConfig"
    WHERE "teamId" = ${state.teamId} AND "key" = ${KEY} AND "value"->>'token' = ${state.token}
    AND ("value"->>'expiresAt')::numeric > extract(epoch from clock_timestamp()) * 1000
    AND ("value"->>'deadlineAt')::numeric > extract(epoch from clock_timestamp()) * 1000 FOR UPDATE`;
  if (!owner.length || state.lost) {
    state.lost = true;
    throw new Error("批量导入执行锁已失效，请刷新页面后重试。");
  }
}
