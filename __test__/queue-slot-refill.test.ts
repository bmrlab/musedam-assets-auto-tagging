// @vitest-environment node
let processPendingQueueItems: typeof import("@/app/(tagging)/queue").processPendingQueueItems;
import type { TaggingQueueItem } from "@/prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as TaggingQueueItem[],
  started: [] as number[],
  gates: new Map<
    number,
    { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  >(),
  maxActive: 0,
  active: 0,
  cooperative: true,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(tagging)/queue-role", () => ({
  IS_QUEUE_WORKER_CHILD: false,
  QUEUE_PAUSED_BY_ENV: false,
  USE_QUEUE_WORKER_PROCESS: false,
}));
vi.mock("@/app/(tagging)/queue-config", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // Two tree slots let this integration exercise real dispatch without invoking a paid model.
  TOTAL_QUEUE_CONCURRENCY: 3,
  TAG_TREE_RESERVED_CONCURRENCY: 2,
  ASSET_TAGGING_CONCURRENCY: 1,
}));
vi.mock("@/app/(tagging)/queue-candidates", () => ({
  loadFairQueueCandidates: async (lane: string) =>
    lane === "tree"
      ? state.rows.filter((row) => row.status === "pending").map((row) => ({ ...row }))
      : [],
}));
vi.mock("@/app/tags/tagTreeQueue", () => ({
  isTagTreeJob: () => true,
  processTagTreeQueueItem: async (row: TaggingQueueItem) => {
    state.started.push(row.id);
    state.maxActive = Math.max(state.maxActive, ++state.active);
    try {
      const { getQueueExecution, throwIfQueueAborted } = await import(
        "@/lib/tagging/queue-execution"
      );
      const signal = getQueueExecution()?.signal;
      if (state.cooperative && signal) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          state.gates.get(row.id)!.promise.then(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, reject);
        });
      } else await state.gates.get(row.id)!.promise;
      throwIfQueueAborted();
      state.rows.find((item) => item.id === row.id)!.status = "completed";
    } catch (error) {
      state.rows.find((item) => item.id === row.id)!.status = "failed";
      throw error;
    } finally {
      state.active--;
    }
  },
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $executeRaw: vi.fn(async () => 0),
    taggingQueueItem: {
      findFirst: vi.fn(
        async ({ where }) =>
          state.rows.find((row) => row.id === where.id && row.status === where.status) ?? null,
      ),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async ({ where }) =>
        state.rows
          .filter((row) => row.status === "pending" && where.id.in.includes(row.id))
          // A database lookup by ID can return the selected rows in any order.
          .reverse()
          .map((row) => ({ ...row, assetObject: null })),
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = state.rows.find((row) => row.id === where.id && row.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/logging", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { rootLogger: logger };
});

beforeEach(async () => {
  vi.resetModules();
  ({ processPendingQueueItems } = await import("@/app/(tagging)/queue"));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T08:00:00Z"));
  state.rows = [1, 2, 3].map((id) => ({
    id,
    teamId: 7,
    status: "pending",
    taskType: "manual",
    assetObjectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startsAt: null,
    endsAt: null,
    extra: {},
    result: {},
  }));
  state.started = [];
  state.active = 0;
  state.maxActive = 0;
  state.cooperative = true;
  for (const id of [1, 2, 3]) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    state.gates.set(id, { promise, resolve, reject });
  }
});
afterEach(async () => {
  for (const gate of state.gates.values()) gate.resolve();
  await vi.advanceTimersByTimeAsync(0);
  vi.clearAllTimers();
  vi.useRealTimers();
  state.gates.clear();
});

describe("queue slot refill", () => {
  it.each([false, true])(
    "starts the next job before a slow sibling finishes (fast job fails: %s)",
    async (failure) => {
      let originalBatchFinished = false;
      const batch = processPendingQueueItems().then(() => {
        originalBatchFinished = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(state.started).toEqual([1, 2]);
      // The scheduler is still awaiting this batch. Job 1 will run for another minute.
      await vi.advanceTimersByTimeAsync(1000);
      if (failure) state.gates.get(2)!.reject(new Error("model failed"));
      else state.gates.get(2)!.resolve();
      await vi.advanceTimersByTimeAsync(2000);
      expect(originalBatchFinished).toBe(false);
      expect(state.started).toEqual([1, 2, 3]);
      expect(state.rows.find((row) => row.id === 1)!.status).toBe("processing");
      expect(state.maxActive).toBe(2);
      state.gates.get(1)!.resolve();
      state.gates.get(3)!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await batch;
    },
  );
  it("serializes overlapping dispatches so the same job is not launched twice", async () => {
    const first = processPendingQueueItems();
    const second = processPendingQueueItems();
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(state.started).toEqual([1, 2]);
    for (const gate of state.gates.values()) gate.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await first;
    expect(state.started).toEqual([1, 2, 3]);
    expect(state.maxActive).toBeLessThanOrEqual(2);
  });
});

it("cancels cooperative calls before refilling, keeping real concurrency within budget", async () => {
  const batch = processPendingQueueItems();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 2000);
  await batch;
  expect(state.started).toEqual([1, 2, 3]);
  expect(state.maxActive).toBe(2);
  expect(state.rows.find((row) => row.id === 1)!.status).toBe("failed");
});
it("retains permits for calls that ignore cancellation, even beyond the grace period", async () => {
  state.cooperative = false;
  let finished = false;
  const batch = processPendingQueueItems().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 20_000);
  expect(state.active).toBe(2);
  expect(state.started).toEqual([1, 2]);
  expect(finished).toBe(false);
  state.gates.get(1)!.resolve();
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.started).toEqual([1, 2, 3]);
  expect(state.maxActive).toBe(2);
  state.gates.get(2)!.resolve();
  state.gates.get(3)!.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await batch;
});
