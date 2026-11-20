// @vitest-environment node
import { GET, POST } from "@/app/api/tags/imports/route";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  allowed: true,
  upload: vi.fn(),
  getUpload: vi.fn(),
  submit: vi.fn(),
  preview: vi.fn(),
  find: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/requestAuth", () => ({ getAuthSession: mocks.session }));
vi.mock("@/app/tags/tagManagementAuth", () => ({
  withTagManagementAuth: async (
    run: (context: { user: { id: number }; team: { id: number } }) => unknown,
  ) =>
    mocks.allowed
      ? run({ user: { id: 9 }, team: { id: 7 } })
      : { success: false, code: "forbidden", message: "denied" },
}));
vi.mock("@/app/tags/tagImportJobs", () => ({
  createTagImportUpload: mocks.upload,
  getTagImportUpload: mocks.getUpload,
  submitTagImportJob: mocks.submit,
  precheckTagImportUpload: mocks.preview,
}));
vi.mock("@/prisma/prisma", () => ({ default: { taggingQueueItem: { findFirst: mocks.find } } }));
const id = "70c372cf-6b55-41a4-a333-bf855780cf25";
const post = (body: unknown) =>
  POST(
    new NextRequest("https://auto.example/api/tags/imports", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.session.mockResolvedValue({ user: { id: 9 }, team: { id: 7 } });
  mocks.getUpload.mockResolvedValue({ uploadId: id, jobId: 42 });
  mocks.submit.mockResolvedValue(42);
});
it("denies unauthenticated and unauthorized writes before storage or queue operations", async () => {
  const body = { action: "submit", uploadId: id, level: 4, mode: "overwrite", locale: "zh-CN" };
  mocks.session.mockResolvedValueOnce(null);
  expect((await post(body)).status).toBe(401);
  mocks.allowed = false;
  expect((await post(body)).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.getUpload).not.toHaveBeenCalled();
});
it("submits only a server-issued file ID and validates the confirmed options", async () => {
  expect(
    (await post({ action: "submit", uploadId: id, level: 4, mode: "overwrite", locale: "zh-CN" }))
      .status,
  ).toBe(200);
  expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(7, 9, id, {
    level: 4,
    mode: "overwrite",
    locale: "zh-CN",
  });
  expect(
    (
      await post({
        action: "submit",
        uploadId: "https://untrusted.example/file",
        level: 4,
        mode: "overwrite",
        locale: "zh-CN",
      })
    ).status,
  ).toBe(400);
});
it("rejects oversized files and invalid options before issuing an upload URL", async () => {
  expect(
    (
      await post({
        action: "upload",
        filename: "tags.csv",
        size: 6 * 1024 * 1024,
        sha256: "a".repeat(64),
      })
    ).status,
  ).toBe(400);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("bounds job queries to the authenticated team and submitting user", async () => {
  mocks.find.mockResolvedValue(null);
  const response = await GET(new NextRequest("https://auto.example/api/tags/imports?jobId=42"));
  expect(response.status).toBe(404);
  expect(mocks.find.mock.calls[0][0].where).toEqual({
    teamId: 7,
    id: 42,
    AND: [
      { extra: { path: ["jobKind"], equals: "tag-tree-import" } },
      { extra: { path: ["userId"], equals: 9 } },
    ],
  });
});
it("resolves a lost submit response through the upload receipt without another write", async () => {
  mocks.find.mockResolvedValue({
    id: 42,
    status: "completed",
    result: { success: true, data: { successCount: 1 } },
  });
  const response = await GET(
    new NextRequest(`https://auto.example/api/tags/imports?uploadId=${id}`),
  );
  expect((await response.json()).data).toMatchObject({ jobId: 42, outcome: { success: true } });
  expect(mocks.getUpload).toHaveBeenCalledExactlyOnceWith(7, 9, id);
  expect(mocks.submit).not.toHaveBeenCalled();
});
