/** Feature decision and OCR settings. */
export const FEATURE_DECISION_MODE: "llm" | "legacy" = "llm";
export const FEATURE_LLM_TIMEOUT_MS = 300_000;
export const FEATURE_LLM_MAX_OUTPUT_TOKENS = 8192;
// Queue image evidence gets a bounded attempt while a text decision runs alongside it.
export const FEATURE_IMAGE_ATTEMPT_BUDGET_MS = 90_000;
export const FEATURE_TEXT_FALLBACK_BUDGET_MS = 60_000;

export function getQueueFeatureBudgetMs(isVideo: boolean, imageMode: boolean) {
  return isVideo ? (imageMode ? 360_000 : 240_000) : (imageMode ? 240_000 : 150_000);
}

/** Image evidence is opt-in for non-interactive decision calls. */
export function isDecisionLlmImageUseEnabled(): boolean {
  return process.env.DECISION_LLM_IMAGE_USE === "true";
}
