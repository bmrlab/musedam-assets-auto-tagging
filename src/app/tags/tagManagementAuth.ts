import "server-only";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import { slugToId } from "@/lib/slug";
import { fetchMuseDAMUser } from "@/musedam/user";

type AuthContext = Parameters<Parameters<typeof withAuth>[0]>[0];

export async function withTagManagementAuth<T>(
  action: (context: AuthContext) => Promise<ServerActionResult<T>>,
): Promise<ServerActionResult<T>> {
  return withAuth(async (context) => {
    try {
      const member = await fetchMuseDAMUser({
        team: context.team,
        timeoutMs: 15_000,
        musedamUserId: slugToId("user", context.user.slug),
      });
      // 缺失字段（旧版主站）或查询失败一律拒绝，不能用应用访问权限或角色名称替代。
      if (member.canManageTags !== true) {
        return { success: false, code: "forbidden", message: "没有标签管理权限" };
      }
    } catch {
      return { success: false, code: "forbidden", message: "无法确认标签管理权限，请稍后重试" };
    }
    return action(context);
  });
}
