import { withAuth } from "@/app/(auth)/withAuth";
import { createTagTreeJob } from "@/app/tags/tagTreeQueue";
import { isValidLocale } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  prompt: z.string().min(1),
  lang: z.string().default("zh-CN"),
  requestId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  return withAuth(async ({ user, team }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, message: "Invalid JSON body" } as const, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: parsed.error.issues.map((i) => i.message).join(", ") } as const,
        { status: 400 },
      );
    }

    const { prompt, lang: langRaw, requestId } = parsed.data;
    const lang = isValidLocale(langRaw) ? langRaw : "zh-CN";

    const item = await createTagTreeJob({
      teamId: team.id,
      userId: user.id,
      prompt,
      lang,
      requestId,
    });

    rootLogger.info({
      msg: "tag-tree job api submitted",
      jobId: item.id,
      teamId: team.id,
      userId: user.id,
      lang,
      requestId,
      promptLength: prompt.length,
    });

    return NextResponse.json({
      success: true,
      data: { jobId: item.id },
    });
  });
}
