import { withFeatureBudget } from "@/lib/tagging/operation-budget";
import { throwIfQueueAborted } from "@/lib/tagging/queue-execution";
import "server-only";
import { hasFeatureRecognitionFailure } from "./completion";
import { FEATURE_IMAGE_ATTEMPT_BUDGET_MS, FEATURE_TEXT_FALLBACK_BUDGET_MS } from "./config";
import { runFeatureDecision } from "./service";
import type { FeatureDecisionCandidate, FeatureDecisionDiagnostics } from "./types";

type DecisionInput = Parameters<typeof runFeatureDecision>[0];

/** Reuse one retrieval/OCR pass. Reference downloads never delay the text safety net. */
export async function runImageDecisionWithTextFallback(
  input: DecisionInput,
  prepareImages: () => Promise<FeatureDecisionCandidate[]>,
): Promise<{ diagnostics: FeatureDecisionDiagnostics; candidates: FeatureDecisionCandidate[] }> {
  input.signal?.throwIfAborted();
  const failed = (
    error: unknown,
    imageMode: boolean,
    previous?: FeatureDecisionDiagnostics,
  ): FeatureDecisionDiagnostics => ({
    ...previous,
    mode: "llm",
    decisionInputMode: imageMode ? "image" : "text",
    ocr: previous?.ocr ?? input.ocr ?? { status: "skipped", segments: [] },
    decision: {
      ...previous?.decision,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    },
  });
  const textController = new AbortController();
  const textSignal = input.signal
    ? AbortSignal.any([input.signal, textController.signal])
    : textController.signal;
  let textMs = 0;
  const textStarted = Date.now();
  let textDiagnostics: FeatureDecisionDiagnostics | undefined;
  const text = withFeatureBudget(FEATURE_TEXT_FALLBACK_BUDGET_MS, async () => {
    textDiagnostics = await runFeatureDecision({
      ...input,
      imageMode: false,
      signal: textSignal,
    });
    return textDiagnostics;
  })
    .catch((error) => failed(error, false, textDiagnostics))
    .finally(() => {
      textMs = Date.now() - textStarted;
    });
  let candidates = input.candidates;
  const imageStarted = Date.now();
  let referencePreparationMs = 0;
  let imageDiagnostics: FeatureDecisionDiagnostics | undefined;
  const image = await withFeatureBudget(FEATURE_IMAGE_ATTEMPT_BUDGET_MS, async () => {
    let prepared: FeatureDecisionCandidate[];
    try {
      prepared = await prepareImages();
    } finally {
      referencePreparationMs = Date.now() - imageStarted;
    }
    if (prepared.length !== input.candidates.length)
      throw Error("Some image references could not be prepared");
    candidates = prepared;
    imageDiagnostics = await runFeatureDecision({
      ...input,
      candidates: prepared,
      imageMode: true,
    });
    return imageDiagnostics;
  }).catch((error) => failed(error, true, imageDiagnostics));
  const imageMs = Date.now() - imageStarted;
  input.signal?.throwIfAborted();
  throwIfQueueAborted();
  const imageSucceeded =
    image.decision.status === "completed" && !hasFeatureRecognitionFailure(image);
  if (imageSucceeded)
    textController.abort(new Error("Image decision completed; text fallback no longer needed"));
  const textResult = await text;
  input.signal?.throwIfAborted();
  throwIfQueueAborted();
  return {
    candidates: imageSucceeded ? candidates : input.candidates,
    diagnostics: {
      ...(imageSucceeded ? image : textResult),
      decisionInputMode: imageSucceeded ? "image" : "text",
      timings: { referencePreparationMs, imageAttemptMs: imageMs, textAttemptMs: textMs },
      imageFallback: {
        used: !imageSucceeded,
        ...(!imageSucceeded
          ? { reason: image.decision.error ?? "Image decision did not complete" }
          : {}),
        // The selected attempt is already stored in diagnostics.decision.
        ...(imageSucceeded
          ? { textDecision: textResult.decision }
          : { imageDecision: image.decision }),
      },
    },
  };
}
