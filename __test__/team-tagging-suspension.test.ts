// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), admin: vi.fn(), team: vi.fn(), config: vi.fn(),
  upsert: vi.fn(), cancel: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
  create: vi.fn(), findTask: vi.fn(), update: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/requestAuth", () => ({ getAuthSession: mocks.session }));
vi.mock("@/lib/admin", () => ({ isAdminUserSlug: mocks.admin }));
vi.mock("@/prisma/prisma", () => ({ default: {
  team: { findUnique: mocks.team },
  teamConfig: { findUnique: mocks.config },
  taggingQueueItem: { findUnique: mocks.findTask, update: mocks.update },
  $transaction: mocks.transaction,
} }));

import { POST } from "@/app/(tagging)/api/tagging/admin/team-suspension/route";
import { enqueueTaggingTask, processQueueItem } from "@/app/(tagging)/queue";
import { isTeamTaggingSuspended, TeamTaggingSuspendedError } from "@/lib/tagging/team-suspension";
import type { AssetObject } from "@/prisma/client";

const request = (suspended: unknown = true) => new NextRequest("https://example.test/api/tagging/admin/team-suspension", {
  method: "POST", body: JSON.stringify({ musedamTeamId: "158057", suspended }),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { slug: "u/1" } });
  mocks.admin.mockReturnValue(true);
  mocks.team.mockResolvedValue({ id: 42, slug: "t/158057", name: "team" });
  mocks.config.mockResolvedValue({ value: true });
  mocks.cancel.mockResolvedValue({ count: 3 });
  mocks.findTask.mockResolvedValue({ extra: { rerunRequested: true } });
  mocks.transaction.mockImplementation(async (fn) => fn({
    $queryRaw: mocks.lock,
    teamConfig: { upsert: mocks.upsert, findUnique: mocks.config },
    taggingQueueItem: { updateMany: mocks.cancel, create: mocks.create },
  }));
});

describe("team tagging suspension", () => {
  it.each([null, { user: { slug: "u/2" } }])("requires an administrator before any mutation", async (session) => {
    mocks.session.mockResolvedValue(session);
    mocks.admin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(session ? 403 : 401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("atomically suspends and cancels only this team's active asset tasks", async () => {
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ success: true, suspended: true, cancelled: 3 });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId_key: { teamId: 42, key: "taggingSuspended" } },
      update: { value: true },
    }));
    expect(mocks.cancel).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 42, assetObjectId: { not: null }, status: { in: ["pending", "processing"] } },
      data: expect.objectContaining({ status: "failed", result: expect.objectContaining({ error: "CANCELLED" }) }),
    }));
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.upsert.mock.invocationCallOrder[0]);
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.cancel.mock.invocationCallOrder[0]);
  });

  it("resuming does not resurrect cancelled tasks", async () => {
    expect(await (await POST(request(false))).json()).toMatchObject({ suspended: false, cancelled: 0 });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: false } }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean suspension without writing configuration", async () => {
    expect((await POST(request("false"))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rolls back through the transaction and reports cancellation failure", async () => {
    mocks.cancel.mockRejectedValue(Error("database error"));
    expect((await POST(request())).status).toBe(500);
  });

  it("does not cache the suspension state", async () => {
    expect(await isTeamTaggingSuspended(42)).toBe(true);
    mocks.config.mockResolvedValue({ value: false });
    expect(await isTeamTaggingSuspended(42)).toBe(false);
  });

  it("blocks enqueue inside the same team lock used by suspension", async () => {
    await expect(enqueueTaggingTask({ assetObject: { id: 7, teamId: 42 } as AssetObject }))
      .rejects.toBeInstanceOf(TeamTaggingSuspendedError);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.config.mock.invocationCallOrder[0]);
  });

  it("cancels a task claimed after suspension instead of running or honoring rerunRequested", async () => {
    await processQueueItem({
      id: 9, teamId: 42, assetObjectId: 7, status: "processing", taskType: "default",
      extra: { rerunRequested: true }, assetObject: { id: 7, teamId: 42 } as AssetObject,
      result: {}, createdAt: new Date(), updatedAt: new Date(), startsAt: new Date(), endsAt: null,
    });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9 },
      data: expect.objectContaining({ status: "failed", result: expect.objectContaining({ error: "CANCELLED" }) }),
    }));
  });
});
