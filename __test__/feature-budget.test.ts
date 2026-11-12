import { runInAbortableSlot } from "@/lib/tagging/abortable-slot";
import pLimit from "p-limit";
// @vitest-environment node
import { JinaCircuit } from "@/lib/brand/jina-circuit";
import { FeatureBudgetExceededError, withFeatureBudget } from "@/lib/tagging/operation-budget";
import {
  queueSleep,
  runWithQueueExecution,
  throwIfQueueAborted,
} from "@/lib/tagging/queue-execution";
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.useRealTimers());
it("cancels feature work while allowing ordinary work and final queue writes", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  await runWithQueueExecution(
    { queueItemId: 1, attempt: "a", signal: controller.signal, assertOwned: async () => {} },
    async () => {
      const feature = withFeatureBudget(100, () => queueSleep(1000));
      const rejected = expect(feature).rejects.toBeInstanceOf(FeatureBudgetExceededError);
      const ordinary = queueSleep(200);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(controller.signal.aborted).toBe(false);
      expect(() => throwIfQueueAborted()).not.toThrow();
      await vi.advanceTimersByTimeAsync(100);
      await ordinary;
    },
  );
});
it("does not release work which ignores cancellation until it really settles", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  let settled = false;
  const feature = withFeatureBudget(
    100,
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(feature).rejects.toBeInstanceOf(FeatureBudgetExceededError);
  void feature.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(settled).toBe(false);
  finish();
  await rejected;
});
it("rejects an exhausted budget before starting calls", async () => {
  const run = vi.fn(async () => {});
  await expect(withFeatureBudget(0, run)).rejects.toBeInstanceOf(FeatureBudgetExceededError);
  expect(run).not.toHaveBeenCalled();
});
it("opens after three failures and permits just one recovery probe", () => {
  vi.useFakeTimers();
  const circuit = new JinaCircuit();
  for (let i = 0; i < 3; i++) circuit.acquire()("failure");
  expect(() => circuit.acquire()).toThrow("JINA_UNAVAILABLE");
  vi.advanceTimersByTime(60_000);
  const probe = circuit.acquire();
  expect(() => circuit.acquire()).toThrow("circuit open");
  probe("success");
  expect(() => circuit.acquire()).not.toThrow();
});
it("ignores cancellation, and stale successes cannot close a newly opened circuit", () => {
  vi.useFakeTimers();
  const circuit = new JinaCircuit();
  const oldSuccess = circuit.acquire();
  for (let i = 0; i < 5; i++) circuit.acquire()("ignore");
  for (let i = 0; i < 3; i++) circuit.acquire()("failure");
  oldSuccess("success");
  expect(() => circuit.acquire()).toThrow("circuit open");
  vi.advanceTimersByTime(60_000);
  circuit.acquire()("failure");
  expect(() => circuit.acquire()).toThrow("circuit open");
});

it("cancels a slot waiter without dispatching ghost work after the occupied slot frees", async () => {
  const limit = pLimit(1);
  let release!: () => void;
  const running = limit(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await Promise.resolve();
  const work = vi.fn(async () => {});
  await expect(withFeatureBudget(10, () => runInAbortableSlot(limit, work))).rejects.toBeInstanceOf(
    FeatureBudgetExceededError,
  );
  expect(limit.activeCount).toBe(1);
  release();
  await running;
  await limit(async () => {});
  expect(work).not.toHaveBeenCalled();
});
