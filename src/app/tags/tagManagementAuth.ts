import "server-only";

import { withAuth } from "@/app/(auth)/withAuth";
import type { ServerActionResult } from "@/lib/serverAction";
import {
  TAG_MANAGEMENT_PROOF_HEADER,
  verifyTagManagementProof,
} from "@/lib/tagging/tag-management-proof";
import { headers } from "next/headers";
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
    const proof = (await headers()).get(TAG_MANAGEMENT_PROOF_HEADER);
    if (!verifyTagManagementProof(proof, context.user.id, context.team.id)) {
      return {
        success: false,
        code: "forbidden",
        message: "无法确认标签管理权限，请在主站中重新操作",
      };
    }
    // 嵌套保存沿用本次已验证授权；不将凭据缓存到其他请求或团队。
    return authorizedRequest.run(identity, () => action(context));
  });
}
