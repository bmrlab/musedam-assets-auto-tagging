import { APICallError, RetryError } from "ai";

/** Inspect only error metadata, never serialize SDK errors (they retain request bodies). */
export function isLLMInputTooLargeError(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isLLMInputTooLargeError(error.lastError);
  if (!(error instanceof Error)) return false;
  const detail = APICallError.isInstance(error) ? (error.responseBody ?? "") : "";
  return /input_too_large|context_length_exceeded|ContextWindowExceeded|prompt is too long|input token count exceeds|maximum context length/i.test(
    `${error.message} ${detail}`,
  );
}

// Conservative character ceiling for text-only tag calls, including tag keywords and
// asset content. A final check complements the candidate selector's estimated budget.
export const TAGGING_INPUT_CHAR_LIMIT = 120_000;
export const TAGGING_INPUT_TOO_LARGE = "TAGGING_INPUT_TOO_LARGE";

export function taggingInputTooLargeError() {
  return Object.assign(new Error("AI tagging input exceeds the request budget"), {
    code: TAGGING_INPUT_TOO_LARGE,
  });
}

export function checkTaggingPrompt(text: string): string {
  if (text.length > TAGGING_INPUT_CHAR_LIMIT) throw taggingInputTooLargeError();
  return text;
}
