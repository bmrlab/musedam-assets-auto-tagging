// @vitest-environment node
import { callFeatureLlm } from "@/lib/feature-decision/gateway";
import {
  assertQueueExecutionOwned,
  queueAbortSignal,
  queueSleep,
  runWithQueueExecution,
} from "@/lib/tagging/queue-execution";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const usage = vi.hoisted(() => vi.fn(async () => ({ id: "usage-1" })));
vi.mock("@/prisma/prisma", () => ({ default: { featureLlmCall: { create: usage } } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});
const context = (controller: AbortController) => ({
  queueItemId: 1,
  attempt: "a",
  signal: controller.signal,
  assertOwned: vi.fn(async () => {}),
});
it("merges parent cancellation and stops waiting without changing non-queue signals", async () => {
  const controller = new AbortController();
  const original = new AbortController().signal;
  expect(queueAbortSignal(original)).toBe(original);
  const task = runWithQueueExecution(context(controller), async () => {
    const combined = queueAbortSignal(original)!;
    const sleep = queueSleep(60_000);
    controller.abort(Error("deadline"));
    expect(combined.aborted).toBe(true);
    await sleep;
  });
  await expect(task).rejects.toThrow("deadline");
});
it("checks cancellation before ownership lookup or side effects", async () => {
  const controller = new AbortController();
  const owner = context(controller);
  controller.abort(Error("cancelled"));
  await expect(runWithQueueExecution(owner, () => assertQueueExecutionOwned())).rejects.toThrow(
    "cancelled",
  );
  expect(owner.assertOwned).not.toHaveBeenCalled();
});
it("aborts the actual decision HTTP call and still records failed-call accounting", async () => {
  vi.stubEnv("OPENAI_BASE_URL", "https://example.test");
  vi.stubEnv("OPENAI_API_KEY", "test");
  const request = vi.fn(
    async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  );
  vi.stubGlobal("fetch", request);
  const controller = new AbortController();
  const task = runWithQueueExecution(context(controller), () =>
    callFeatureLlm({
      context: { teamId: 7, queueItemId: 1 },
      kind: "decision",
      model: "model",
      messages: [],
      parse: (text) => text,
    }),
  );
  expect(request).toHaveBeenCalledTimes(1);
  controller.abort(Error("deadline"));
  const result = await task;
  expect(result.call.status).toBe("failed");
  expect(result.call.error).toContain("deadline");
  expect(usage).toHaveBeenCalledTimes(1);
});
