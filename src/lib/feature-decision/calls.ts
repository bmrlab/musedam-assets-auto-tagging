import type { FeatureDecisionDiagnostics, FeatureLlmCallDiagnostics } from "./types";

/** Include both attempts without counting the selected call twice. */
export function getFeatureLlmCalls(
  diagnostics: FeatureDecisionDiagnostics,
): FeatureLlmCallDiagnostics[] {
  const decisions = [
    diagnostics.decision,
    diagnostics.imageFallback?.imageDecision,
    diagnostics.imageFallback?.textDecision,
  ];
  const calls = [
    diagnostics.ocr.call,
    ...decisions.flatMap(
      (decision) =>
        decision?.batches?.map((batch) => batch.call) ?? (decision?.call ? [decision.call] : []),
    ),
  ];
  const seen = new Set<string | FeatureLlmCallDiagnostics>();
  return calls.filter((call): call is FeatureLlmCallDiagnostics => {
    if (!call || seen.has(call.id ?? call)) return false;
    seen.add(call.id ?? call);
    return true;
  });
}
