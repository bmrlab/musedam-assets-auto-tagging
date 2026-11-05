/** Feature decision settings are code constants, shared by OCR and decision calls. */
export const FEATURE_DECISION_MODE: "llm" | "legacy" = "llm";
export const FEATURE_LLM_TIMEOUT_MS = 300_000;
export const FEATURE_LLM_MAX_OUTPUT_TOKENS = 8192;
