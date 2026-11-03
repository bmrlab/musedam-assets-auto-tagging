import { POST } from "@/app/(tagging)/api/tagging/admin/restore-deleted-assets/route";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), restore: vi.fn() }));
vi.mock("@/app/(auth)/requestAuth", () => ({ getAuthSession: mocks.session }));
vi.mock("@/lib/admin", () => ({ isAdminUserSlug: mocks.admin }));
vi.mock("@/lib/logging", () => ({ rootLogger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/tagging/restore-deleted-assets", () => ({ restoreDeletedAssets: mocks.restore }));

const request = (body: unknown) =>
  new NextRequest("https://example.test/api/tagging/admin/restore-deleted-assets", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { slug: "u/1" } });
  mocks.admin.mockReturnValue(true);
  mocks.restore.mockResolvedValue({ dryRun: true, results: [] });
});
it("requires a signed-in application administrator", async () => {
  mocks.session.mockResolvedValueOnce(null);
  expect((await POST(request({}))).status).toBe(401);
  mocks.admin.mockReturnValue(false);
  expect((await POST(request({}))).status).toBe(403);
  expect(mocks.restore).not.toHaveBeenCalled();
});
it("defaults to preview and requires a specific team", async () => {
  expect((await POST(request({}))).status).toBe(400);
  expect((await POST(request({ musedamTeamId: "159945" }))).status).toBe(200);
  expect(mocks.restore).toHaveBeenCalledWith(
    expect.objectContaining({ dryRun: true, musedamTeamId: "159945" }),
  );
});
it("requires explicit acknowledgement before resetting historical statuses", async () => {
  expect((await POST(request({ musedamTeamId: "159945", dryRun: false }))).status).toBe(400);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(
    (await POST(request({ musedamTeamId: "159945", dryRun: false, acknowledgeStatusReset: true })))
      .status,
  ).toBe(200);
});
it("rejects oversized batches and unknown parameters", async () => {
  expect((await POST(request({ musedamTeamId: "159945", limit: 51 }))).status).toBe(400);
  expect((await POST(request({ musedamTeamId: "159945", teamId: 2 }))).status).toBe(400);
  expect(mocks.restore).not.toHaveBeenCalled();
});
