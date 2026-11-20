// @vitest-environment node
import {
  createTagImportUpload,
  getTagImportUpload,
  processTagImportQueueItem,
  readTagImportFile,
  submitTagImportJob,
} from "@/app/tags/tagImportJobs";
import type { TaggingQueueItem } from "@/prisma/client";
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const config = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
  const queue = { create: vi.fn(), update: vi.fn() };
  const tx = { teamConfig: config, taggingQueueItem: queue, $queryRaw: vi.fn() };
  return {
    config,
    queue,
    tx,
    import: vi.fn(),
    preview: vi.fn(),
    owned: vi.fn(),
    context: vi.fn(async (_ctx, run) => run()),
    fetch: vi.fn(),
    sign: vi.fn(() => ({ signedUrl: "https://storage.example/private-upload" })),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    teamConfig: mocks.config,
    taggingQueueItem: mocks.queue,
    $transaction: async (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
    user: { findUniqueOrThrow: async () => ({ id: 9, slug: "u/99" }) },
    team: { findUniqueOrThrow: async () => ({ id: 7, slug: "t/77" }) },
  },
}));
vi.mock("@/lib/s3", () => ({
  buildTagImportObjectKey: (team: number, id: string, ext: string) =>
    `tag-imports/${team}/${id}.${ext}`,
  getBrowserS3ObjectUploadUrl: mocks.sign,
  signS3ObjectUrl: () => ({ signedUrl: "https://storage.example/private-read" }),
}));
vi.mock("@/app/tags/tagBatchActions", () => ({
  importTagTreeAction: mocks.import,
  precheckTagTreeImportAction: mocks.preview,
}));
vi.mock("@/app/tags/tagImportJobContext", () => ({ runTagImportJobContext: mocks.context }));
vi.mock("@/lib/tagging/queue-execution", () => ({
  assertQueueExecutionOwned: mocks.owned,
  queueAbortSignal: (signal: AbortSignal) => signal,
}));
const bytes = Buffer.from("tag,keywords\nA,one");
const upload = () => ({
  uploadId: "70c372cf-6b55-41a4-a333-bf855780cf25",
  userId: 9,
  filename: "tags.csv",
  objectKey: "tag-imports/7/test.csv",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  expiresAt: Date.now() + 60_000,
});
const options = { mode: "overwrite" as const, level: 4 as const, locale: "zh-CN" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.config.findUnique.mockResolvedValue({ value: upload() });
  mocks.queue.create.mockResolvedValue({ id: 42 });
  mocks.fetch.mockImplementation(async () => new Response(bytes));
  mocks.import.mockResolvedValue({
    success: true,
    data: { successCount: 1, failedCount: 0, skippedCount: 0, failures: [] },
  });
});
it("issues a private upload URL and stores metadata without file content or login credentials", async () => {
  const result = await createTagImportUpload(7, 9, {
    filename: "tags.csv",
    size: bytes.length,
    sha256: upload().sha256,
  });
  expect(result.uploadId).toMatch(/^[a-f0-9-]{36}$/);
  expect(mocks.sign).toHaveBeenCalledWith(expect.objectContaining({ acl: "private" }));
  expect(mocks.config.create.mock.calls[0][0].data).toMatchObject({
    teamId: 7,
    value: { userId: 9, size: bytes.length },
  });
  expect(JSON.stringify(mocks.config.create.mock.calls)).not.toContain(bytes.toString());
});
it("isolates uploads by both team and submitting user", async () => {
  await expect(getTagImportUpload(8, 10, upload().uploadId)).rejects.toThrow("not found");
  expect(mocks.config.findUnique).toHaveBeenCalledWith({
    where: { teamId_key: { teamId: 8, key: `tag-import-upload:${upload().uploadId}` } },
  });
});
it("serializes submission through the upload row and reuses its job after a lost response", async () => {
  expect(await submitTagImportJob(7, 9, upload().uploadId, options)).toBe(42);
  expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
  const stored = mocks.config.update.mock.calls[0][0].data.value;
  mocks.config.findUnique.mockResolvedValue({ value: stored });
  expect(await submitTagImportJob(7, 9, upload().uploadId, options)).toBe(42);
  expect(mocks.queue.create).toHaveBeenCalledOnce();
  await expect(
    submitTagImportJob(7, 9, upload().uploadId, { ...options, mode: "merge" }),
  ).rejects.toThrow("different options");
});
it("checks actual size and hash instead of trusting uploaded metadata", async () => {
  const file = await readTagImportFile(upload());
  expect(await file.text()).toBe(bytes.toString());
  mocks.fetch.mockResolvedValueOnce(new Response(Buffer.from("tampered")));
  await expect(readTagImportFile(upload())).rejects.toThrow("changed");
  mocks.fetch.mockResolvedValueOnce(
    new Response(bytes, { headers: { "content-length": String(6 * 1024 * 1024) } }),
  );
  await expect(readTagImportFile(upload())).rejects.toThrow("too large");
});
it("executes the existing import once with the persisted identity and confirmed mode", async () => {
  mocks.config.findUnique.mockResolvedValue({ value: { ...upload(), options, jobId: 42 } });
  await processTagImportQueueItem({
    id: 42,
    teamId: 7,
    extra: { userId: 9, uploadId: upload().uploadId },
  } as unknown as TaggingQueueItem);
  expect(mocks.import).toHaveBeenCalledOnce();
  const form = mocks.import.mock.calls[0][0] as FormData;
  expect(form.get("importMode")).toBe("overwrite");
  expect(form.get("tagLevel")).toBe("4");
  expect(mocks.context.mock.calls[0][0]).toMatchObject({
    user: { id: 9 },
    team: { id: 7 },
    locale: "zh-CN",
  });
  expect(mocks.queue.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
  );
});
it("fails a mismatched persisted receipt before any import and does not retry mutations", async () => {
  mocks.config.findUnique.mockResolvedValue({ value: { ...upload(), options, jobId: 99 } });
  await processTagImportQueueItem({
    id: 42,
    teamId: 7,
    extra: { userId: 9, uploadId: upload().uploadId },
  } as unknown as TaggingQueueItem);
  expect(mocks.import).not.toHaveBeenCalled();
  expect(mocks.queue.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
  );
});
