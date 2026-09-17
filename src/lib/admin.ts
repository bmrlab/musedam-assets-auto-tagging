import "server-only";

import { slugToId } from "@/lib/slug";

// admin 用户 id（MuseDAM user id，非 slug）通过环境变量 ADMIN_USER_IDS 配置，多个用逗号隔开。
// 未配置时回退到 SaaS 生产的 admin，私有化环境务必配置成客户侧管理员的 id。
// 浏览器端拿不到这个环境变量，前端请用 session.user.isAdmin（见 authOptions 的 session callback）。
const DEFAULT_ADMIN_USER_IDS = ["1632673793052180480"];

export function getAdminUserIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS;
  if (raw === undefined) return DEFAULT_ADMIN_USER_IDS;
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isAdminUserSlug(userSlug?: string | null): boolean {
  if (!userSlug) return false;
  try {
    return getAdminUserIds().includes(slugToId("user", userSlug).toString());
  } catch {
    return false;
  }
}
