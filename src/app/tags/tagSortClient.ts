import type { ServerActionResult } from "@/lib/serverAction";
import type { SavedTagSort } from "./tagSort";

export class TagSortRequestError extends Error {
  constructor(
    public status?: number,
    public requestId?: string,
  ) {
    super("Tag sort response could not be confirmed");
  }
}

/** 固定 JSON 接口，不依赖部署时生成的 Server Action ID；未知结果不自动重试。 */
export async function saveTagSort(
  tags: SavedTagSort[],
): Promise<ServerActionResult<{ sorts: SavedTagSort[] }>> {
  let response: Response;
  try {
    response = await fetch("/api/tags/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new TagSortRequestError();
  }
  const rawId = response.headers.get("x-request-id");
  const requestId = rawId && /^[a-zA-Z0-9_-]{1,80}$/.test(rawId) ? rawId : undefined;
  const body: unknown = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  if (body && typeof body === "object" && "success" in body) {
    if (body.success === false && "message" in body && typeof body.message === "string") {
      return { success: false, message: body.message };
    }
    if (
      response.ok &&
      body.success === true &&
      "data" in body &&
      body.data &&
      typeof body.data === "object" &&
      "sorts" in body.data
    ) {
      const sorts = body.data.sorts;
      const ids = new Set(tags.map((item) => item.id));
      if (
        Array.isArray(sorts) &&
        sorts.length === ids.size &&
        sorts.every(
          (item) =>
            item &&
            Number.isSafeInteger(item.id) &&
            Number.isInteger(item.sort) &&
            ids.delete(item.id),
        ) &&
        !ids.size
      ) {
        return { success: true, data: { sorts } };
      }
    }
  }
  throw new TagSortRequestError(response.status, requestId);
}
