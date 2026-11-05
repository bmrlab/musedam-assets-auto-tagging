import "server-only";

import { callFeatureLlm } from "./gateway";
import { parseFeatureDecisionResponse, parseOcrResponse } from "./parsing";
import { boundOcrSegments, buildFeatureDecisionMessages, buildOcrMessages } from "./prompts";
import type {
  FeatureDecisionCandidate,
  FeatureDecisionDiagnostics,
  FeatureLlmContext,
  FeatureOcrDiagnostics,
} from "./types";

export async function runFeatureDecision(
  input: FeatureLlmContext & {
    sourceImage: string;
    imageMode?: boolean;
    fileName?: string;
    folderPath?: string;
    candidates: FeatureDecisionCandidate[];
  },
): Promise<FeatureDecisionDiagnostics> {
  const imageMode = input.imageMode ?? true;
  const diagnosticsMode = {
    mode: "llm" as const,
    decisionInputMode: imageMode ? ("image" as const) : ("text" as const),
  };
  if (!input.sourceImage.trim()) {
    return {
      ...diagnosticsMode,
      ocr: { status: "skipped", segments: [], error: "No usable source image" },
      decision: { status: "skipped", error: "No usable source image" },
    };
  }
  const context = {
    teamId: input.teamId,
    queueItemId: input.queueItemId,
    assetObjectId: input.assetObjectId,
  };
  let ocr: FeatureOcrDiagnostics;
  const ocrModel = process.env.OCR_MODEL?.trim();
  if (!ocrModel) {
    ocr = { status: "disabled", segments: [] };
  } else {
    const { call, result } = await callFeatureLlm({
      context,
      kind: "ocr",
      model: ocrModel,
      messages: buildOcrMessages(input.sourceImage),
      parse: (text) => parseOcrResponse(text, 1),
    });
    const segments = result ? boundOcrSegments(result.content[0]) : [];
    ocr = {
      status: call.status === "failed" ? "failed" : segments.length ? "completed" : "empty",
      segments,
      call,
      ...(call.error ? { error: call.error } : {}),
    };
  }

  if (input.candidates.length === 0) {
    return {
      ...diagnosticsMode,
      ocr,
      decision: { status: "skipped", error: "No eligible candidates" },
    };
  }
  if (
    input.candidates.length > 15 ||
    new Set(input.candidates.map((candidate) => candidate.candidateId)).size !==
      input.candidates.length ||
    (imageMode && input.candidates.some((candidate) => !candidate.referenceImage?.trim()))
  ) {
    return {
      ...diagnosticsMode,
      ocr,
      decision: {
        status: "failed",
        error: imageMode
          ? "Expected at most 15 unique candidates, each with a usable reference image"
          : "Expected at most 15 unique candidates",
      },
    };
  }
  const { call, result } = await callFeatureLlm({
    context,
    kind: "decision",
    model: process.env.FEATURE_DECISION_MODEL?.trim() ?? "",
    messages: buildFeatureDecisionMessages({ ...input, ocr }),
    parse: (text) => parseFeatureDecisionResponse(text, input.candidates, imageMode),
  });
  return {
    ...diagnosticsMode,
    ocr,
    decision: {
      status: call.status,
      ...(result ? { result } : {}),
      call,
      ...(call.error ? { error: call.error } : {}),
    },
  };
}
