// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), list: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({ withAuth: (run: (context: unknown) => unknown) => run({ team: { id: 7 } }) }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn() }));
vi.mock("@/musedam/assets", () => ({ batchSyncAssetThumbnails: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: {
  taggingQueueItem: { findFirst: m.find, update: m.update },
  $transaction: (run: (tx: unknown) => unknown) => run({ taggingQueueItem: { findMany: m.list, updateMany: m.updateMany } }),
} }));
import { retryAllFailedTasks, retryFailedTask } from "@/app/(tagging)/tagging/dashboard/actions";
beforeEach(() => { vi.resetAllMocks(); });
it.each([false, true])("preserves existing evidence only for feature-only retry %s", async inPlace => {
  m.find.mockResolvedValue({ id: 1, extra: { featureRetryInPlace: inPlace } });
  expect((await retryFailedTask(1)).success).toBe(true);
  const data = m.update.mock.calls[0][0].data;
  expect(data.status).toBe("pending");
  if (inPlace) expect(data).not.toHaveProperty("result");
  else expect(data.result).toEqual({});
});
it("bulk retry keeps feature evidence and does not create another task", async () => {
  m.list.mockResolvedValue([{ id: 1 }]);
  m.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
  expect(await retryAllFailedTasks()).toEqual({ success: true, data: { count: 3 } });
  expect(m.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
    where: expect.objectContaining({ id: { notIn: [1] } }), data: expect.objectContaining({ result: {} }),
  }));
  expect(m.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: { in: [1] } }) }));
  expect(m.updateMany.mock.calls[1][0].data).not.toHaveProperty("result");
  expect(m.updateMany.mock.calls.every(([arg]) => arg.where.assetObjectId?.not === null)).toBe(true);
});
it("cannot replay an administrative import through asset task retry controls", async () => {
  m.find.mockImplementation(async ({ where }) => where.assetObjectId?.not === null ? null : { id: 42, extra: { jobKind: "tag-tree-import" } });
  expect(await retryFailedTask(42)).toMatchObject({ success: false });
  expect(m.update).not.toHaveBeenCalled();
});
