import { APICallError, RetryError } from "ai";
import { describe, expect, it, vi } from "vitest";

import { isLLMApiCallError, resolveModelChain, runWithModelFallback } from "@/ai/model-fallback";

function overdueError() {
  return new APICallError({
    message: "Access forbidden: account overdue",
    url: "https://gateway/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 403,
    isRetryable: false,
  });
}

describe("isLLMApiCallError", () => {
  it("recognises APICallError and RetryError wrapping one", () => {
    expect(isLLMApiCallError(overdueError())).toBe(true);
    const retry = new RetryError({
      message: "max retries",
      reason: "maxRetriesExceeded",
      errors: [overdueError()],
    });
    expect(isLLMApiCallError(retry)).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isLLMApiCallError(new Error("timeout"))).toBe(false);
    expect(isLLMApiCallError(undefined)).toBe(false);
  });
});

describe("resolveModelChain", () => {
  it("uses default fallbacks when env is unset, dedupes primary", () => {
    expect(resolveModelChain("gpt-5-mini", undefined, "claude-sonnet-4-6")).toEqual([
      "gpt-5-mini",
      "claude-sonnet-4-6",
    ]);
    expect(resolveModelChain("a", " b , a ,, c ", "x")).toEqual(["a", "b", "c"]);
  });

  it("disables fallback with an empty env value", () => {
    expect(resolveModelChain("gpt-5-mini", "", "claude-sonnet-4-6")).toEqual(["gpt-5-mini"]);
  });
});

describe("runWithModelFallback", () => {
  it("switches to the next model when the provider call fails", async () => {
    const onFallback = vi.fn();
    const run = vi.fn(async (model: string) => {
      if (model === "primary") throw overdueError();
      return model;
    });
    await expect(runWithModelFallback(["primary", "backup"], run, onFallback)).resolves.toBe(
      "backup",
    );
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ failedModel: "primary", nextModel: "backup" }),
    );
  });

  it("does not switch models for non-provider errors", async () => {
    const run = vi.fn(async () => {
      throw new Error("schema mismatch");
    });
    await expect(runWithModelFallback(["primary", "backup"], run)).rejects.toThrow(
      "schema mismatch",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every model fails", async () => {
    const run = vi.fn(async () => {
      throw overdueError();
    });
    await expect(runWithModelFallback(["primary", "backup"], run)).rejects.toThrow(
      "account overdue",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });
});
