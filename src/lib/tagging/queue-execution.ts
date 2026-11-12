import { AsyncLocalStorage } from "node:async_hooks";
import { getOperationSignal } from "./operation-budget";

export type QueueExecution = {
  queueItemId: number;
  attempt: string;
  signal: AbortSignal;
  assertOwned: () => Promise<void>;
};
const execution = new AsyncLocalStorage<QueueExecution>();
export function runWithQueueExecution<T>(
  context: QueueExecution,
  run: () => PromiseLike<T>,
): Promise<T> {
  // Await inside the context as Prisma promises are lazy and may otherwise execute outside it.
  return execution.run(context, async () => await run());
}
export function getQueueExecution() {
  return execution.getStore();
}
export function throwIfQueueAborted() {
  execution.getStore()?.signal.throwIfAborted();
  getOperationSignal()?.throwIfAborted();
}
export function queueAbortSignal(signal?: AbortSignal): AbortSignal | undefined {
  const signals = [execution.getStore()?.signal, getOperationSignal(), signal].filter(
    (item): item is AbortSignal => !!item,
  );
  for (const item of signals) item.throwIfAborted();
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}
export async function assertQueueExecutionOwned() {
  const context = execution.getStore();
  if (!context) return;
  context.signal.throwIfAborted();
  await context.assertOwned();
  context.signal.throwIfAborted();
}

export function queueSleep(ms: number): Promise<void> {
  const signal = queueAbortSignal();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
