import { rootLogger } from "@/lib/logging";
import { buildTagImportObjectKey, getBrowserS3ObjectUploadUrl, signS3ObjectUrl } from "@/lib/s3";
import type { ServerActionResult } from "@/lib/serverAction";
import { assertQueueExecutionOwned, queueAbortSignal } from "@/lib/tagging/queue-execution";
import type { TaggingQueueItem } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { createHash, randomUUID } from "node:crypto";
import "server-only";
import type { TagTreeBatchImportResult } from "./tagBatchActions";
import { importTagTreeAction, precheckTagTreeImportAction } from "./tagBatchActions";
import { TAG_BATCH_MAX_FILE_BYTES } from "./tagBatchSpreadsheet";
import { runTagImportJobContext } from "./tagImportJobContext";

export const TAG_IMPORT_JOB_KIND = "tag-tree-import";
const uploadKey = (id: string) => `tag-import-upload:${id}`;
export type TagImportUpload = {
  uploadId: string;
  objectKey: string;
  filename: string;
  size: number;
  sha256: string;
  userId: number;
  expiresAt: number;
  jobId?: number;
  options?: { mode: "merge" | "overwrite"; level: 3 | 4; locale: string; skipRows?: number[] };
};
type ImportExtra = { jobKind: typeof TAG_IMPORT_JOB_KIND; uploadId: string; userId: number };

export function isTagImportJob(item: Pick<TaggingQueueItem, "extra">) {
  return (item.extra as Record<string, unknown> | null)?.jobKind === TAG_IMPORT_JOB_KIND;
}

export async function createTagImportUpload(
  teamId: number,
  userId: number,
  file: { filename: string; size: number; sha256: string },
) {
  const uploadId = randomUUID();
  const extension = file.filename.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const objectKey = buildTagImportObjectKey(teamId, uploadId, extension);
  const upload: TagImportUpload = {
    ...file,
    uploadId,
    objectKey,
    userId,
    expiresAt: Date.now() + 30 * 60_000,
  };
  await prisma.teamConfig.create({ data: { teamId, key: uploadKey(uploadId), value: upload } });
  const { signedUrl } = getBrowserS3ObjectUploadUrl({
    objectKey,
    contentType: "application/octet-stream",
    expiresInSeconds: 30 * 60,
    acl: "private",
  });
  return { uploadId, uploadUrl: signedUrl };
}

export async function getTagImportUpload(teamId: number, userId: number, uploadId: string) {
  const record = await prisma.teamConfig.findUnique({
    where: { teamId_key: { teamId, key: uploadKey(uploadId) } },
  });
  const upload = record?.value as TagImportUpload | null;
  if (!upload || upload.userId !== userId || upload.uploadId !== uploadId)
    throw new Error("Import upload not found");
  return upload;
}

/** Read only server-issued object keys. Enforce actual bytes, declared size and digest before parsing. */
export async function readTagImportFile(upload: TagImportUpload) {
  const { signedUrl } = signS3ObjectUrl({ objectKey: upload.objectKey, expiresInSeconds: 60 });
  const response = await fetch(signedUrl, {
    redirect: "error",
    cache: "no-store",
    signal: queueAbortSignal(AbortSignal.timeout(30_000)),
  });
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > TAG_BATCH_MAX_FILE_BYTES
  )
    throw new Error("Import file unavailable or too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > TAG_BATCH_MAX_FILE_BYTES || size > upload.size)
        throw new Error("Import file size changed");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  if (size !== upload.size || createHash("sha256").update(bytes).digest("hex") !== upload.sha256)
    throw new Error("Import file changed; upload it again");
  return new File([bytes], upload.filename, { type: "application/octet-stream" });
}

export async function precheckTagImportUpload(upload: TagImportUpload, level: 3 | 4) {
  if (upload.expiresAt < Date.now()) throw new Error("Import upload expired");
  const data = new FormData();
  data.set("file", await readTagImportFile(upload));
  data.set("tagLevel", String(level));
  return precheckTagTreeImportAction(data);
}

/** Lock the upload receipt so double-clicks and lost responses return the same persisted job. */
export async function submitTagImportJob(
  teamId: number,
  userId: number,
  uploadId: string,
  options: NonNullable<TagImportUpload["options"]>,
) {
  const jobId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "TeamConfig" WHERE "teamId" = ${teamId} AND "key" = ${uploadKey(uploadId)} FOR UPDATE`;
    const row = await tx.teamConfig.findUnique({
      where: { teamId_key: { teamId, key: uploadKey(uploadId) } },
    });
    const upload = row?.value as TagImportUpload | null;
    if (!upload || upload.userId !== userId) throw new Error("Import upload not found");
    if (upload.jobId) {
      if (
        upload.options?.mode !== options.mode ||
        upload.options.level !== options.level ||
        upload.options.locale !== options.locale ||
        JSON.stringify(upload.options.skipRows ?? []) !== JSON.stringify(options.skipRows ?? [])
      )
        throw new Error("This upload has already been submitted with different options");
      return upload.jobId;
    }
    if (upload.expiresAt < Date.now()) throw new Error("Import upload expired");
    const item = await tx.taggingQueueItem.create({
      data: {
        teamId,
        status: "pending",
        taskType: "manual",
        result: {},
        extra: { jobKind: TAG_IMPORT_JOB_KIND, uploadId, userId } satisfies ImportExtra,
      },
    });
    await tx.teamConfig.update({
      where: { teamId_key: { teamId, key: uploadKey(uploadId) } },
      data: { value: { ...upload, options, jobId: item.id } },
    });
    return item.id;
  });
  rootLogger.info({ msg: "Tag import job accepted", jobId, teamId, userId, mode: options.mode });
  return jobId;
}

export async function processTagImportQueueItem(item: TaggingQueueItem) {
  const extra = item.extra as unknown as ImportExtra;
  await assertQueueExecutionOwned();
  let outcome: ServerActionResult<TagTreeBatchImportResult>;
  let phase = "load-upload";
  rootLogger.info({ msg: "Tag import job started", jobId: item.id, teamId: item.teamId });
  try {
    const upload = await getTagImportUpload(item.teamId, extra.userId, extra.uploadId);
    if (upload.jobId !== item.id || !upload.options) throw new Error("Import job receipt mismatch");
    const [user, team] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: extra.userId },
        select: { id: true, slug: true },
      }),
      prisma.team.findUniqueOrThrow({
        where: { id: item.teamId },
        select: { id: true, slug: true },
      }),
    ]);
    phase = "read-file";
    const file = await readTagImportFile(upload);
    const data = new FormData();
    data.set("file", file);
    data.set("tagLevel", String(upload.options.level));
    data.set("importMode", upload.options.mode);
    data.set("treeImport", "true");
    if (upload.options.skipRows?.length)
      data.set("skipRows", JSON.stringify(upload.options.skipRows));
    // A persisted job represents an operation authorized at submission, bound to one immutable upload/mode.
    phase = "apply-import";
    outcome = await runTagImportJobContext(
      { user: { ...user, isAdmin: false }, team, locale: upload.options.locale },
      () => importTagTreeAction(data),
    );
  } catch {
    rootLogger.warn({ msg: "Tag import job failed", jobId: item.id, teamId: item.teamId, phase });
    outcome = {
      success: false,
      message: "Import failed; check the result before submitting another import",
    };
  }
  await assertQueueExecutionOwned();
  await prisma.taggingQueueItem.update({
    where: { id: item.id },
    data: {
      status: outcome.success ? "completed" : "failed",
      endsAt: new Date(),
      result: outcome as object,
    },
  });
  rootLogger.info({
    msg: "Tag import job finished",
    jobId: item.id,
    teamId: item.teamId,
    success: outcome.success,
  });
}
