// @vitest-environment node
import {
  FEATURE_IMAGE_ATTEMPT_BUDGET_MS,
  FEATURE_TEXT_FALLBACK_BUDGET_MS,
  getQueueFeatureBudgetMs,
} from "@/lib/feature-decision/config";
import { runImageDecisionWithTextFallback } from "@/lib/feature-decision/image-fallback";
import { runFeatureDecision } from "@/lib/feature-decision/service";
import type { FeatureDecisionDiagnostics } from "@/lib/feature-decision/types";
import { withFeatureBudget } from "@/lib/tagging/operation-budget";
import { queueSleep } from "@/lib/tagging/queue-execution";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/feature-decision/service", () => ({ runFeatureDecision: vi.fn() }));
const decision = vi.mocked(runFeatureDecision);
const candidate = {
  candidateId: "logo:one",
  classId: "one",
  name: "HERA",
  typeName: "Logo",
  featureType: "logo" as const,
  similarity: 0.9,
};
const input = {
  teamId: 1,
  queueItemId: 12,
  sourceImage: "source",
  candidates: [candidate],
  ocr: { status: "empty" as const, segments: [] },
};
const success = (imageMode: boolean, matched = true): FeatureDecisionDiagnostics => ({
  mode: "llm",
  decisionInputMode: imageMode ? "image" : "text",
  ocr: input.ocr,
  decision: {
    status: "completed",
    result: {
      outcome: matched ? "matched" : "no_match",
      matches: matched
        ? [
            {
              candidateId: "logo:one",
              confidence: imageMode ? 95 : 80,
              evidence: [imageMode ? "visual" : "filename"],
              reason: "Matched",
              conflicts: [],
              specificityLimit: null,
            },
          ]
        : [],
    },
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
it("starts text before reference preparation finishes and uses it after image failure", async () => {
  const prepare = vi.fn(async () => {
    expect(decision).toHaveBeenCalledWith(
      expect.objectContaining({ imageMode: false, candidates: [candidate], ocr: input.ocr }),
    );
    throw Error("reference unavailable");
  });
  decision.mockImplementation(async (args) => success(args.imageMode === true));
  const selected = await runImageDecisionWithTextFallback(input, prepare);
  expect(selected.diagnostics.decisionInputMode).toBe("text");
  expect(selected.diagnostics.imageFallback).toMatchObject({
    used: true,
    reason: "reference unavailable",
  });
  expect(selected.candidates).toEqual([candidate]);
  expect(decision).toHaveBeenCalledOnce();
});
it("uses the completed text result when the image attempt hits its deadline without rerunning retrieval", async () => {
  decision.mockImplementation(async (args) => {
    if (args.imageMode) await queueSleep(200_000);
    return success(args.imageMode === true);
  });
  const prepare = vi.fn(async () => [{ ...candidate, referenceImage: "reference" }]);
  const task = runImageDecisionWithTextFallback(input, prepare);
  await vi.advanceTimersByTimeAsync(FEATURE_IMAGE_ATTEMPT_BUDGET_MS + 1);
  const selected = await task;
  expect(selected.diagnostics.decisionInputMode).toBe("text");
  expect(selected.diagnostics.decision.result?.matches[0].confidence).toBe(80);
  expect(selected.diagnostics.imageFallback?.reason).toContain("FEATURE_BUDGET_EXCEEDED");
  expect(prepare).toHaveBeenCalledOnce();
  expect(decision).toHaveBeenCalledTimes(2);
});
it.each([true, false])(
  "keeps successful image decisions including genuine no-match (matched: %s)",
  async (matched) => {
    decision.mockImplementation(async (args) =>
      success(args.imageMode === true, args.imageMode ? matched : true),
    );
    const selected = await runImageDecisionWithTextFallback(input, async () => [
      { ...candidate, referenceImage: "reference" },
    ]);
    expect(selected.diagnostics.decisionInputMode).toBe("image");
    expect(selected.diagnostics.imageFallback?.used).toBe(false);
    expect(selected.diagnostics.decision.result?.matches.length).toBe(matched ? 1 : 0);
  },
);
it("does not turn two failed decisions into successful features", async () => {
  decision.mockResolvedValue({
    ocr: input.ocr,
    decision: { status: "failed", error: "gateway unavailable" },
  });
  const selected = await runImageDecisionWithTextFallback(input, async () => [
    { ...candidate, referenceImage: "reference" },
  ]);
  expect(selected.diagnostics.decision.status).toBe("failed");
  expect(selected.diagnostics.imageFallback?.imageDecision?.status).toBe("failed");
});
it("bounds a hanging text fallback independently", async () => {
  decision.mockImplementation(async () => {
    await queueSleep(200_000);
    return success(false);
  });
  const task = runImageDecisionWithTextFallback(input, async () => {
    throw Error("bad reference");
  });
  await vi.advanceTimersByTimeAsync(FEATURE_TEXT_FALLBACK_BUDGET_MS + 1);
  expect((await task).diagnostics.decision.status).toBe("failed");
});
it("propagates parent cancellation instead of accepting a completed text fallback", async () => {
  decision.mockImplementation(async (args) => {
    if (args.imageMode) await queueSleep(200_000);
    return success(args.imageMode === true);
  });
  const task = withFeatureBudget(100, () =>
    runImageDecisionWithTextFallback(input, async () => [
      { ...candidate, referenceImage: "reference" },
    ]),
  );
  const rejected = expect(task).rejects.toThrow("FEATURE_BUDGET_EXCEEDED");
  await vi.advanceTimersByTimeAsync(101);
  await rejected;
});
it("allocates room for image evidence while retaining existing text limits", () => {
  expect(getQueueFeatureBudgetMs(true, true)).toBe(360_000);
  expect(getQueueFeatureBudgetMs(true, false)).toBe(240_000);
  expect(getQueueFeatureBudgetMs(false, true)).toBe(240_000);
  expect(getQueueFeatureBudgetMs(false, false)).toBe(150_000);
});

it("cancels the unused text request after image success without waiting for its deadline", async () => {
  decision.mockImplementation(async (args) => {
    if (args.imageMode) {
      await queueSleep(10);
      return success(true);
    }
    await new Promise((_resolve, reject) => {
      args.signal!.addEventListener("abort", () => reject(args.signal!.reason), { once: true });
    });
    return success(false);
  });
  const task = runImageDecisionWithTextFallback(input, async () => [
    { ...candidate, referenceImage: "reference" },
  ]);
  await vi.advanceTimersByTimeAsync(11);
  const selected = await task;
  expect(selected.diagnostics.imageFallback?.used).toBe(false);
  expect(selected.diagnostics.timings?.textAttemptMs).toBe(10);
});

it("retains timed-out image call accounting when the branch budget expires", async () => {
  decision.mockImplementation(async (args) => {
    if (!args.imageMode) return success(false);
    try {
      await queueSleep(200_000);
    } catch {
      /* Gateway records cancelled attempts before returning. */
    }
    const recorded = success(true);
    recorded.decision.status = "failed";
    recorded.decision.call = {
      id: "image-attempt",
      kind: "decision",
      model: "vision",
      status: "failed",
      durationMs: 90_000,
      request: { model: "vision", messages: [] },
      response: null,
      rawResponse: null,
      usage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cachedInputTokens: null,
        reasoningTokens: null,
        imageTokens: null,
      },
      costs: {
        currency: "USD",
        inputCost: null,
        outputCost: null,
        totalCost: null,
        inputPricePerMillion: null,
        cachedInputPricePerMillion: null,
        outputPricePerMillion: null,
      },
    };
    return recorded;
  });
  const task = runImageDecisionWithTextFallback(input, async () => [
    { ...candidate, referenceImage: "reference" },
  ]);
  await vi.advanceTimersByTimeAsync(FEATURE_IMAGE_ATTEMPT_BUDGET_MS + 1);
  const selected = await task;
  expect(selected.diagnostics.decisionInputMode).toBe("text");
  expect(selected.diagnostics.imageFallback?.imageDecision?.call?.id).toBe("image-attempt");
});

it("honors an explicitly cancelled video even if its text fallback has already completed", async () => {
  const controller = new AbortController();
  decision.mockImplementation(async (args) => {
    if (args.imageMode) {
      controller.abort(new Error("Video cancelled"));
      return { ocr: input.ocr, decision: { status: "failed", error: "cancelled" } };
    }
    return success(false);
  });
  await expect(
    runImageDecisionWithTextFallback({ ...input, signal: controller.signal }, async () => [
      { ...candidate, referenceImage: "reference" },
    ]),
  ).rejects.toThrow("Video cancelled");
});
