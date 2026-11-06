import pLimit from "p-limit";
import "server-only";
import { MAX_FEATURE_REFERENCES } from "./regions";

import { isDecisionLlmImageUseEnabled } from "./config";
import { callFeatureLlm } from "./gateway";
import { parseFeatureDecisionResponse, parseOcrResponse } from "./parsing";
import { boundOcrSegments, buildFeatureDecisionMessages, buildOcrMessages } from "./prompts";
import type {
  FeatureDecisionCandidate,
  FeatureDecisionDiagnostics,
  FeatureLlmContext,
  FeatureOcrDiagnostics,
} from "./types";

export async function recognizeFeatureOcr(input: FeatureLlmContext & {
  sourceImage: string;
  segments?: string[];
}): Promise<FeatureOcrDiagnostics> {
  const supplied = boundOcrSegments(input.segments ?? []);
  if (supplied.length) return { status: "completed", segments: supplied, source: "musedam" };
  let ocr: FeatureOcrDiagnostics;
  const ocrModel = process.env.OCR_MODEL?.trim();
  if (!ocrModel) {
    ocr = { status: "disabled", segments: [] };
  } else {
    const { call, result } = await callFeatureLlm({
      context: { teamId: input.teamId, queueItemId: input.queueItemId, assetObjectId: input.assetObjectId },
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
  return { ...ocr, source: "model" };
}

export async function runFeatureDecision(
  input: FeatureLlmContext & {
    sourceImage: string;
    imageMode?: boolean;
    fileName?: string;
    folderPath?: string;
    candidates: FeatureDecisionCandidate[];
    ocr?: FeatureOcrDiagnostics;
  },
): Promise<FeatureDecisionDiagnostics> {
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
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
  const ocr = input.ocr ?? await recognizeFeatureOcr(input);

  if (input.candidates.length === 0) {
    return {
      ...diagnosticsMode,
      ocr,
      decision: { status: "skipped", error: "No eligible candidates" },
    };
  }
  if (
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
          ? "Expected unique candidates, each with a usable reference image"
          : "Expected unique candidates",
      },
    };
  }
  const chunks: FeatureDecisionCandidate[][] = [];
  for (let offset = 0; offset < input.candidates.length; offset += MAX_FEATURE_REFERENCES) {
    chunks.push(input.candidates.slice(offset, offset + MAX_FEATURE_REFERENCES));
  }
  const work = pLimit(2);
  const batches = await Promise.all(
    chunks.map((candidates) =>
      work(async () => {
        const { call, result } = await callFeatureLlm({
          context,
          kind: "decision",
          model: process.env.FEATURE_DECISION_MODEL?.trim() ?? "",
          messages: buildFeatureDecisionMessages({ ...input, candidates, imageMode, ocr }),
          parse: (text) => parseFeatureDecisionResponse(text, candidates, imageMode),
        });
        return { candidateIds: candidates.map((candidate) => candidate.candidateId), call, result };
      }),
    ),
  );
  const successful = batches.filter((batch) => batch.call.status === "completed" && batch.result);
  const matches = successful.flatMap((batch) => batch.result!.matches);
  const failed = batches.length - successful.length;
  const completed = successful.length > 0 && (failed === 0 || matches.length > 0);
  return {
    ...diagnosticsMode,
    ocr,
    decision: {
      status: completed ? "completed" : "failed",
      ...(successful.length
        ? { result: { outcome: matches.length ? "matched" : "no_match", matches } as const }
        : {}),
      call: successful[0]?.call ?? batches[0].call,
      ...(batches.length > 1
        ? {
            batches: batches.map((batch) => ({
              candidateIds: batch.candidateIds,
              status: batch.call.status,
              call: batch.call,
              ...(batch.call.error ? { error: batch.call.error } : {}),
            })),
          }
        : {}),
      ...(failed
        ? {
            error:
              batches.length === 1
                ? batches[0].call.error
                : `${failed} of ${batches.length} decision batches failed`,
          }
        : {}),
    },
  };
}
