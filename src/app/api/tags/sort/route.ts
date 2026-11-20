import { getAuthSession } from "@/app/(auth)/requestAuth";
import { updateTagSort } from "@/app/tags/actions";
import { rootLogger } from "@/lib/logging";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  tags: z
    .array(
      z.object({
        id: z.number().int().positive().safe(),
        sort: z.number().int().min(-2147483648).max(2147483647),
      }),
    )
    .min(1)
    .max(20_000),
});

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const headers = { "x-request-id": requestId, "Cache-Control": "no-store" };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers });
  let teamId: number | undefined;
  let teamSlug: string | undefined;
  try {
    const session = await getAuthSession();
    if (!session?.user || !session.team)
      return reply(
        { success: false, code: "unauthorized", message: "登录已失效，请重新进入主站" },
        401,
      );
    teamId = session.team.id;
    teamSlug = session.team.slug;
    if (Number(request.headers.get("content-length")) > 1024 * 1024)
      return reply({ success: false, message: "标签排序请求过大，请刷新后重试" }, 413);
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply({ success: false, message: "标签排序参数无效" }, 400);
    rootLogger.info({
      msg: "Tag sort request",
      requestId,
      teamId,
      teamSlug,
      userId: session.user.id,
      count: input.data.tags.length,
    });
    // 复用已有权限、团队锁、主站同步及持久中断恢复；不能绕过 server action 的鉴权。
    const result = await updateTagSort(input.data.tags);
    const status = result.success
      ? 200
      : result.code === "forbidden"
        ? 403
        : result.code === "busy"
          ? 409
          : 500;
    rootLogger.info({
      msg: "Tag sort response",
      requestId,
      teamId,
      teamSlug,
      status,
      elapsedMs: Date.now() - startedAt,
    });
    return reply(result, status);
  } catch {
    rootLogger.error({
      msg: "Tag sort request failed",
      requestId,
      teamId,
      teamSlug,
      elapsedMs: Date.now() - startedAt,
    });
    return reply({ success: false, message: "标签排序保存失败，请刷新后核对结果" }, 500);
  }
}
