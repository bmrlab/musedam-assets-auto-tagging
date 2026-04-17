import authOptions from "@/app/(auth)/authOptions";
import { executeGenerateTagTreeByLLM } from "@/app/tags/generateTagTreeLLM";
import { isValidLocale, type Locale } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" } as const,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" } as const,
      { status: 400 },
    );
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
    return NextResponse.json({ success: false, message: "Missing prompt" } as const, { status: 400 });
  }

  const lang: Locale = isValidLocale(langRaw) ? langRaw : "zh-CN";

  const result = await executeGenerateTagTreeByLLM({
    finalPrompt: prompt,
    lang,
    teamId: session.team.id,
  });

  rootLogger.info({
    msg: "generate-tag-tree api response",
    teamId: session.team.id,
    userId: session.user.id,
    lang,
    success: result.success,
    message: result.success ? undefined : result.message,
    // 控制日志体积，避免超长输出影响日志系统
    textPreview: result.success ? result.data.text.slice(0, 500) : undefined,
    textLength: result.success ? result.data.text.length : undefined,
    promptLength: prompt.length,
  });

  return NextResponse.json(result);
}
