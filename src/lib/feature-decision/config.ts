/** Feature decision and OCR settings. */
export const FEATURE_DECISION_MODE: "llm" | "legacy" = "llm";
export const FEATURE_DECISION_REASONING_EFFORT = "none";
export const FEATURE_LLM_TIMEOUT_MS = 300_000;
export const FEATURE_LLM_MAX_OUTPUT_TOKENS = 8192;

/** Image evidence is opt-in for non-interactive decision calls. */
export function isDecisionLlmImageUseEnabled(): boolean {
  return process.env.DECISION_LLM_IMAGE_USE === "true";
}
