import authOptions from "@/app/(auth)/authOptions";
import { executeGenerateTagTreeByLLM } from "@/app/tags/generateTagTreeLLM";
import { isValidLocale, type Locale } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const timeoutMs = Number(process.env.TAG_TREE_LLM_TIMEOUT_MS ?? 45000);

  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    const response = NextResponse.json(
      { success: false, message: "Unauthorized" } as const,
      { status: 401, headers: { "x-request-id": requestId } },
    );
    rootLogger.warn({
      msg: "generate-tag-tree api unauthorized",
      requestId,
      elapsedMs: Date.now() - startedAt,
    });
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const response = NextResponse.json(
      { success: false, message: "Invalid JSON body" } as const,
      { status: 400, headers: { "x-request-id": requestId } },
    );
    rootLogger.warn({
      msg: "generate-tag-tree api invalid body",
      requestId,
      teamId: session.team.id,
      userId: session.user.id,
      elapsedMs: Date.now() - startedAt,
    });
    return response;
  }

  const prompt =
    body && typeof body === "object" && "prompt" in body && typeof (body as { prompt: unknown }).prompt === "string"
      ? (body as { prompt: string }).prompt
      : "";
  const langRaw =
    body && typeof body === "object" && "lang" in body && typeof (body as { lang: unknown }).lang === "string"
      ? (body as { lang: string }).lang
      : "zh-CN";

  if (!prompt.trim()) {
    const response = NextResponse.json(
      { success: false, message: "Missing prompt" } as const,
      { status: 400, headers: { "x-request-id": requestId } },
    );
    rootLogger.warn({
      msg: "generate-tag-tree api missing prompt",
      requestId,
      teamId: session.team.id,
      userId: session.user.id,
      elapsedMs: Date.now() - startedAt,
    });
    return response;
  }

  const lang: Locale = isValidLocale(langRaw) ? langRaw : "zh-CN";

  rootLogger.info({
    msg: "generate-tag-tree api start",
    requestId,
    teamId: session.team.id,
    userId: session.user.id,
    lang,
    promptLength: prompt.length,
    timeoutMs,
  });

  const timeoutResult = new Promise<{
    timedOut: true;
    result: { success: false; message: string };
  }>((resolve) => {
    setTimeout(() => {
      resolve({
        timedOut: true,
        result: {
          success: false,
          message: `标签生成超时（>${timeoutMs}ms），请重试`,
        },
      });
    }, timeoutMs);
  });

  const llmResultPromise = executeGenerateTagTreeByLLM({
    finalPrompt: prompt,
    lang,
    teamId: session.team.id,
    requestId,
  }).then((result) => ({ timedOut: false as const, result }));

  const { timedOut, result } = await Promise.race([llmResultPromise, timeoutResult]);

  rootLogger.info({
    msg: "generate-tag-tree api response",
    requestId,
    teamId: session.team.id,
    userId: session.user.id,
    lang,
    timedOut,
    success: result.success,
    message: result.success ? undefined : result.message,
    // 控制日志体积，避免超长输出影响日志系统
    textPreview: result.success ? result.data.text.slice(0, 500) : undefined,
    textLength: result.success ? result.data.text.length : undefined,
    promptLength: prompt.length,
    elapsedMs: Date.now() - startedAt,
  });

  return NextResponse.json(result, { headers: { "x-request-id": requestId } });
}
