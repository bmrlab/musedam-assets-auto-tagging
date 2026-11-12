import { queueAbortSignal } from "@/lib/tagging/queue-execution";
import "server-only";

import type { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { FEATURE_LLM_MAX_OUTPUT_TOKENS, FEATURE_LLM_TIMEOUT_MS } from "./config";
import {
  extractFeatureLlmUsage,
  getUnavailableFeatureLlmCosts,
  parseChatEnvelope,
} from "./parsing";
import type {
  FeatureChatMessage,
  FeatureChatRequest,
  FeatureJsonValue,
  FeatureLlmCallDiagnostics,
  FeatureLlmContext,
} from "./types";

function errorMessage(cause: unknown, fallback: string): string {
  // DOMException and errors from another realm need not be instanceof this realm's Error.
  return cause !== null &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
    ? cause.message
    : fallback;
}

/** A single HTTP attempt, including failed/invalid responses in the accounting record. */
export async function callFeatureLlm<T>(input: {
  context: FeatureLlmContext;
  kind: "ocr" | "decision";
  model: string;
  messages: FeatureChatMessage[];
  parse: (text: string) => T;
  signal?: AbortSignal;
}): Promise<{ call: FeatureLlmCallDiagnostics; result?: T }> {
  const startedAt = Date.now();
  const request: FeatureChatRequest = {
    model: input.model,
    messages: input.messages,
    max_tokens: FEATURE_LLM_MAX_OUTPUT_TOKENS,
    ...(input.kind === "decision"
      ? {
          // The Qwen gateway rejects reasoning_effort when enable_thinking is set.
          enable_thinking: false,
          response_format: { type: "json_object" },
        }
      : {}),
  };
  let rawResponse: FeatureJsonValue = null;
  let response: string | null = null;
  let result: T | undefined;
  let error: string | undefined;
  let requestTimeout: AbortSignal | undefined;
  let requestSignal: AbortSignal | undefined;

  try {
    const baseUrl = process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "");
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!baseUrl || !apiKey)
      throw new Error("Set OPENAI_BASE_URL and OPENAI_API_KEY for feature OCR and decision calls");
    if (!input.model.trim())
      throw new Error(`Set ${input.kind === "ocr" ? "OCR_MODEL" : "FEATURE_DECISION_MODEL"}`);
    requestTimeout = AbortSignal.timeout(FEATURE_LLM_TIMEOUT_MS);
    requestSignal = queueAbortSignal(
      input.signal ? AbortSignal.any([requestTimeout, input.signal]) : requestTimeout,
    );
    const httpResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request),
      signal: requestSignal,
    });
    const body = await httpResponse.text();
    try {
      rawResponse = JSON.parse(body);
    } catch {
      rawResponse = body;
    }
    if (!httpResponse.ok)
      throw new Error(`Feature ${input.kind} gateway returned HTTP ${httpResponse.status}`);
    const envelope = parseChatEnvelope(rawResponse);
    response = envelope.choices[0].message.content;
    if (envelope.choices[0].finish_reason === "length")
      throw new Error("Feature LLM response was truncated");
    if (envelope.choices[0].message.refusal || !response?.trim())
      throw new Error("Feature LLM returned no usable assistant content");
    result = input.parse(response);
  } catch (cause) {
    if (requestSignal?.aborted) {
      error =
        requestSignal.reason === requestTimeout?.reason
          ? `Feature ${input.kind} request exceeded its ${FEATURE_LLM_TIMEOUT_MS / 1000}s deadline`
          : input.signal?.aborted
            ? `Video processing deadline expired during the feature ${input.kind} request`
            : errorMessage(requestSignal.reason, `Feature ${input.kind} request was cancelled`);
    } else {
      error = errorMessage(cause, "Feature LLM request failed");
    }
  }

  const usage = extractFeatureLlmUsage(rawResponse);
  const costs = getUnavailableFeatureLlmCosts();
  const call: FeatureLlmCallDiagnostics = {
    kind: input.kind,
    model: input.model,
    status: error ? "failed" : "completed",
    durationMs: Date.now() - startedAt,
    request,
    response,
    rawResponse,
    usage,
    costs,
    ...(error ? { error } : {}),
  };

  try {
    const record = await prisma.featureLlmCall.create({
      data: {
        ...input.context,
        kind: input.kind,
        model: input.model,
        status: call.status,
        durationMs: call.durationMs,
        request: request as unknown as Prisma.InputJsonValue,
        response,
        ...(rawResponse === null ? {} : { rawResponse: rawResponse as Prisma.InputJsonValue }),
        error,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningTokens: usage.reasoningTokens,
        imageTokens: usage.imageTokens,
        currency: costs.currency,
        inputCost: costs.inputCost,
        outputCost: costs.outputCost,
        totalCost: costs.totalCost,
        inputPricePerMillion: costs.inputPricePerMillion,
        cachedInputPricePerMillion: costs.cachedInputPricePerMillion,
        outputPricePerMillion: costs.outputPricePerMillion,
      },
      select: { id: true },
    });
    call.id = record.id;
  } catch (cause) {
    // Retain the accounting problem in the returned/queue diagnostics without repeating a paid call.
    call.persistenceError = errorMessage(cause, "Could not persist feature LLM usage");
  }
  return { call, ...(result !== undefined ? { result } : {}) };
}
