import { AsyncLocalStorage } from "node:async_hooks";

const operation = new AsyncLocalStorage<AbortSignal>();
export class FeatureBudgetExceededError extends Error {
  constructor(readonly budgetMs: number) {
    super(`FEATURE_BUDGET_EXCEEDED: feature recognition exceeded ${budgetMs}ms`);
    this.name = "FeatureBudgetExceededError";
  }
}
export function getOperationSignal() {
  return operation.getStore();
}

/** Await real completion: native decoders cannot be interrupted and must retain their slots. */
export async function withFeatureBudget<T>(budgetMs: number, run: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const parent = getOperationSignal();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const timer = setTimeout(
    () => controller.abort(new FeatureBudgetExceededError(budgetMs)),
    Math.max(0, budgetMs),
  );
  if (budgetMs <= 0) controller.abort(new FeatureBudgetExceededError(budgetMs));
  try {
    return await operation.run(signal, async () => {
      signal.throwIfAborted();
      const result = await run();
      signal.throwIfAborted();
      return result;
    });
  } finally {
    clearTimeout(timer);
  }
}
