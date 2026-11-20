import { dispatchMuseDAMClientAction } from "@/embed/message";

/** 凭据只用于当前请求，父窗口不支持或校验失败时不产生授权。 */
export async function requestTagManagementProof(appAuthToken: string) {
  try {
    const result = await dispatchMuseDAMClientAction(
      "get-tag-management-permission",
      { appAuthToken },
      { timeoutMs: 15_000 },
    );
    if (
      result.canManageTags !== true ||
      typeof result.proof !== "string" ||
      typeof result.expiresAt !== "number" ||
      result.expiresAt <= Date.now()
    )
      return null;
    return result.proof;
  } catch {
    return null;
  }
}
