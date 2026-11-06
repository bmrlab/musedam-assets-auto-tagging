import type { FeatureDecisionDiagnostics } from "./types";

/** Also detects historical partial results incorrectly recorded as completed. */
export function hasFeatureRecognitionFailure(diagnostics?: FeatureDecisionDiagnostics): boolean {
  return !!diagnostics && diagnostics.mode !== "legacy" && (
    diagnostics.decision?.status === "failed" ||
    !!diagnostics.decision?.error && diagnostics.decision?.status === "completed" ||
    !!diagnostics.decision?.batches?.some(batch => batch.status === "failed") ||
    !!diagnostics.retrieval?.errors?.length ||
    !!diagnostics.retrieval?.unassessedCandidates?.length
  );
}
