import "server-only";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import { checkUserPermission } from "@/app/(auth)/lib";
import { AsyncLocalStorage } from "node:async_hooks";
import { getTagImportJobContext } from "./tagImportJobContext";

type AuthContext = Parameters<Parameters<typeof withAuth>[0]>[0];
const authorizedRequest = new AsyncLocalStorage<string>();

export async function withTagManagementAuth<T>(
  action: (context: AuthContext) => Promise<ServerActionResult<T>>,
): Promise<ServerActionResult<T>> {
  return withAuth(async (context) => {
    const identity = `${context.user.id}:${context.team.id}`;
    if (authorizedRequest.getStore() === identity) return action(context);
    const job = getTagImportJobContext();
    if (job?.team.id === context.team.id && job.user.id === context.user.id)
      return authorizedRequest.run(identity, () => action(context));
    // 复用已有应用管理权限，不接收浏览器布尔值，也不再建立第二套主站授权交换。
    let canManage = false;
    try {
      const access = await checkUserPermission(context);
      canManage = access.roleCode === "admin" || access.roleCode === "content" ||
        ("accessRole" in access && access.accessRole === "admin");
    } catch { /* 原登录/成员校验失败时拒绝写入。 */ }
    if (!canManage) {
      return {
        success: false,
        code: "forbidden",
        message: "无自动打标管理权限",
      };
    }
    // 嵌套保存沿用本次检查，不跨请求或团队缓存。
    return authorizedRequest.run(identity, () => action(context));
  });
}
