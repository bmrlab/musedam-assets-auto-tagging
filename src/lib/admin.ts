import { slugToId } from "@/lib/slug";

// 集中管理 admin 用户 id（MuseDAM user id，非 slug）
// 生产
export const ADMIN_USER_ID = "1632673793052180480";
// export const ADMIN_USER_ID = "1658651142380707840";

export function isAdminUserSlug(userSlug?: string | null): boolean {
  if (!userSlug) return false;
  try {
    return slugToId("user", userSlug).toString() === ADMIN_USER_ID;
  } catch {
    return false;
  }
}
