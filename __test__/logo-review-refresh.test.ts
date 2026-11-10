import { requeuePendingBrandReviewResults } from "@/lib/brand/review-refresh";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: (() => {
    const transactionClient = {
      $queryRaw: mocks.queryRaw,
      taggingQueueItem: { updateMany: mocks.updateMany },
      taggingAuditItem: { deleteMany: mocks.deleteMany },
    };
    return {
      taggingQueueItem: {
        findMany: mocks.findMany,
      },
      $transaction: (callback: (tx: typeof transactionClient) => unknown) =>
        mocks.transaction(callback, transactionClient),
    };
  })(),
}));

describe("logo strategy review refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(
      (callback: (tx: unknown) => unknown, transactionClient: unknown) =>
        callback(transactionClient),
    );
  });

  it("requeues only Logo-enabled legacy/current review results", async () => {
    mocks.findMany.mockResolvedValue([
      { id: 1, extra: { featureClassify: true, featureBrand: true } },
      { id: 2, extra: { featureClassify: true } },
      { id: 3, extra: { featureClassify: true, featureBrand: false } },
      { id: 4, extra: { featureClassify: false, featureBrand: true } },
    ]);
    mocks.queryRaw.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([
      { queueItemId: 1, status: "pending" },
      { queueItemId: 2, status: "pending" },
    ]);

    await expect(requeuePendingBrandReviewResults(9)).resolves.toBe(2);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          teamId: 9,
          status: "completed",
          taskType: { not: "test" },
          taggingAuditItems: {
            some: { status: "pending" },
            none: { status: { not: "pending" } },
          },
        }),
      }),
    );
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { queueItemId: { in: [1, 2] }, status: "pending" },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] }, teamId: 9, status: "completed" },
      data: { status: "pending", startsAt: null, endsAt: null, result: {} },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("preserves an item reviewed while the refresh is starting", async () => {
    mocks.findMany.mockResolvedValue([
      { id: 1, extra: { featureClassify: true, featureBrand: true } },
      { id: 2, extra: { featureClassify: true, featureBrand: true } },
    ]);
    mocks.queryRaw.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([
      { queueItemId: 1, status: "pending" },
      { queueItemId: 2, status: "approved" },
    ]);

    await expect(requeuePendingBrandReviewResults(9)).resolves.toBe(1);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { queueItemId: { in: [1] }, status: "pending" },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [1] }, teamId: 9, status: "completed" } }),
    );
  });

  it("does nothing when there are no eligible review results", async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(requeuePendingBrandReviewResults(9)).resolves.toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
