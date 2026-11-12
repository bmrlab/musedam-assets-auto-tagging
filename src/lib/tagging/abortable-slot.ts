import type { LimitFunction } from "p-limit";
import { queueAbortSignal } from "./queue-execution";

/** Cancel a waiter immediately; running work retains its permit until it really settles. */
export function runInAbortableSlot<T>(limit: LimitFunction, run: () => Promise<T>): Promise<T> {
  const signal = queueAbortSignal();
  if (!signal) return limit(run);
  return new Promise<T>((resolve, reject) => {
    let started = false;
    const abort = () => {
      if (!started) reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void limit(async () => {
      signal.removeEventListener("abort", abort);
      signal.throwIfAborted();
      started = true;
      return run();
    })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
