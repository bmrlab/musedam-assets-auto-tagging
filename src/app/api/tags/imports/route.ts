import { getAuthSession } from "@/app/(auth)/requestAuth";
import { TAG_BATCH_MAX_FILE_BYTES } from "@/app/tags/tagBatchSpreadsheet";
import {
  createTagImportUpload,
  getTagImportUpload,
  precheckTagImportUpload,
  submitTagImportJob,
} from "@/app/tags/tagImportJobs";
import { withTagManagementAuth } from "@/app/tags/tagManagementAuth";
import { isValidLocale } from "@/i18n/routing";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upload"),
    filename: z
      .string()
      .max(200)
      .regex(/\.(csv|xlsx)$/i),
    size: z.number().int().positive().max(TAG_BATCH_MAX_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.literal("precheck"),
    uploadId: z.uuid(),
    level: z.union([z.literal(3), z.literal(4)]),
  }),
  z.object({
    action: z.literal("submit"),
    uploadId: z.uuid(),
    level: z.union([z.literal(3), z.literal(4)]),
    mode: z.enum(["merge", "overwrite"]),
    locale: z.string().refine(isValidLocale),
    skipRows: z.array(z.number().int().min(2).max(Number.MAX_SAFE_INTEGER)).max(20_000).optional(),
  }),
]);
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user || !session.team)
    return json({ success: false, message: "Authentication required" }, 401);
  if (Number(request.headers.get("content-length")) > 256 * 1024)
    return json({ success: false, message: "Request too large" }, 413);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ success: false, message: "Invalid import request" }, 400);
  try {
    const result = await withTagManagementAuth<unknown>(async ({ user, team }) => {
      const body = parsed.data;
      if (body.action === "upload")
        return {
          success: true as const,
          data: await createTagImportUpload(team.id, user.id, body),
        };
      const upload = await getTagImportUpload(team.id, user.id, body.uploadId);
      if (body.action === "precheck") return precheckTagImportUpload(upload, body.level);
      // Validation is repeated by the worker; only explicit confirmation submits a mutation.
      const jobId = await submitTagImportJob(team.id, user.id, body.uploadId, {
        level: body.level,
        mode: body.mode,
        locale: body.locale,
        ...(body.skipRows?.length
          ? { skipRows: [...new Set(body.skipRows)].sort((a, b) => a - b) }
          : {}),
      });
      return { success: true as const, data: { jobId } };
    });
    return json(result, result.success ? 200 : result.code === "forbidden" ? 403 : 400);
  } catch {
    return json(
      { success: false, message: "Import request failed; query your import task before retrying" },
      400,
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user || !session.team)
    return json({ success: false, message: "Authentication required" }, 401);
  const rawId = request.nextUrl.searchParams.get("jobId");
  let id = rawId === null ? undefined : Number(rawId);
  const uploadId = request.nextUrl.searchParams.get("uploadId");
  if (uploadId) {
    if (!z.uuid().safeParse(uploadId).success)
      return json({ success: false, message: "Invalid upload ID" }, 400);
    try {
      id = (await getTagImportUpload(session.team.id, session.user.id, uploadId)).jobId;
    } catch {
      return json({ success: false, message: "Import upload not found" }, 404);
    }
    if (!id) return json({ success: true, data: null });
  }
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
    return json({ success: false, message: "Invalid job ID" }, 400);
  const item = await prisma.taggingQueueItem.findFirst({
    where: {
      teamId: session.team.id,
      ...(id ? { id } : { status: { in: ["pending", "processing"] } }),
      AND: [
        { extra: { path: ["jobKind"], equals: "tag-tree-import" } },
        { extra: { path: ["userId"], equals: session.user.id } },
      ],
    },
    orderBy: { id: "desc" },
    select: { id: true, status: true, result: true, updatedAt: true },
  });
  if (!item && id) return json({ success: false, message: "Import job not found" }, 404);
  return json({
    success: true,
    data: item
      ? {
          jobId: item.id,
          status: item.status,
          updatedAt: item.updatedAt,
          outcome:
            item.status === "completed" || item.status === "failed"
              ? typeof (item.result as Record<string, unknown> | null)?.success === "boolean"
                ? item.result
                : {
                    success: false,
                    message:
                      "Import was interrupted. Check the tag tree before starting another import.",
                  }
              : undefined,
        }
      : null,
  });
}
