import { AsyncLocalStorage } from "node:async_hooks";
import "server-only";

const importSignal = new AsyncLocalStorage<AbortSignal>();

/** Share cancellation with every upstream request, including credential exchange. */
export function runWithTagImportSignal<T>(signal: AbortSignal, run: () => T): T {
  return importSignal.run(signal, run);
}

export function getTagImportSignal(): AbortSignal | undefined {
  return importSignal.getStore();
}

/** Stop cooperative work before entering another write or retry. */
export function throwIfTagImportAborted(): void {
  importSignal.getStore()?.throwIfAborted();
}
