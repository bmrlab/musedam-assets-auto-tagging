import "server-only";

import { isAdminUserSlug } from "@/lib/admin";
import { rootLogger } from "@/lib/logging";
import { idToSlug } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth/next";
import { headers } from "next/headers";
import authOptions from "./authOptions";
import { checkUserPermission, createUserAndTeam } from "./lib";
import { verifyTokenLoginCredential } from "./tokenLogin";

export const AUTH_TOKEN_HEADER = "x-auth-token";

// 团队身份完全由当前请求带的 token 决定，不再读共享 cookie，所以多个 tab 可以各自停留在不同团队。
// 解析 token 要查库、还要调 MuseDAM 校验权限，这里按 token 做短缓存，避免每个请求都走一遍。
const RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const RESOLVE_CACHE_MAX_SIZE = 500;
const resolveCache = new Map<string, { session: Session; expiresAt: number }>();

export class AuthTokenError extends Error {
  constructor(
    public code: "TOKEN_REQUIRED" | "INVALID_TOKEN" | "TOKEN_EXPIRED" | "PERMISSION_DENIED",
  ) {
    super(code);
  }
}

async function resolveToken(token: string): Promise<{ session: Session; tokenExpiresAt: number }> {
  let payload: ReturnType<typeof verifyTokenLoginCredential>;
  try {
    payload = verifyTokenLoginCredential(token);
  } catch {
    throw new AuthTokenError("INVALID_TOKEN");
  }
  if (!payload) {
    // verifyTokenLoginCredential 对「格式不对」和「已过期」都返回 null，这里无法区分，统一按无效处理
    throw new AuthTokenError("INVALID_TOKEN");
  }

  const cached = resolveCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { session: cached.session, tokenExpiresAt: payload.expiresAt };
  }

  const userSlug = idToSlug("user", payload.user.id);
  const teamSlug = idToSlug("team", payload.team.id);
  const [existingUser, existingTeam] = await Promise.all([
    prisma.user.findUnique({ where: { slug: userSlug }, select: { id: true, slug: true } }),
    prisma.team.findUnique({ where: { slug: teamSlug }, select: { id: true, slug: true } }),
  ]);
  const { user, team } =
    existingUser && existingTeam
      ? { user: existingUser, team: existingTeam }
      : await createUserAndTeam({
          user: { name: payload.user.name, slug: userSlug },
          team: { id: undefined, name: payload.team.name, slug: teamSlug },
        });
  try {
    await checkUserPermission({ user, team });
  } catch (error) {
    rootLogger.warn({
      msg: "用户权限检查失败",
      userId: user.id,
      teamId: team.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AuthTokenError("PERMISSION_DENIED");
  }

  const session: Session = {
    user: { id: user.id, slug: user.slug, isAdmin: isAdminUserSlug(user.slug) },
    team: { id: team.id, slug: team.slug },
    expires: new Date(payload.expiresAt).toISOString(),
  };
  if (resolveCache.size >= RESOLVE_CACHE_MAX_SIZE) resolveCache.clear();
  resolveCache.set(token, {
    session,
    expiresAt: Math.min(Date.now() + RESOLVE_CACHE_TTL_MS, payload.expiresAt),
  });
  return { session, tokenExpiresAt: payload.expiresAt };
}

/** 校验指定 token，失败抛 AuthTokenError（给 /api/auth/me 这类需要区分错误原因的地方用）。 */
export async function resolveAuthToken(token: string) {
  return resolveToken(token);
}

/** 取当前请求的登录信息，形状与原来的 getServerSession 一致；没带 token 或校验失败返回 null。 */
export async function getAuthSession(): Promise<Session | null> {
  const token = (await headers()).get(AUTH_TOKEN_HEADER);
  // 兼容期：没带 token（旧版父项目）时退回旧的共享 cookie 登录
  if (!token) return getServerSession(authOptions);
  try {
    return (await resolveToken(token)).session;
  } catch (error) {
    if (!(error instanceof AuthTokenError)) {
      rootLogger.error({ msg: "getAuthSession: 解析 token 失败", error });
    }
    return null;
  }
}
