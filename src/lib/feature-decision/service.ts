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
  FeatureVideoEvidence,
} from "./types";

const MAX_VIDEO_OCR_FRAMES = 4;

export async function recognizeFeatureOcr(input: FeatureLlmContext & {
  sourceImage: string;
  segments?: string[];
  video?: FeatureVideoEvidence;
  signal?: AbortSignal;
}): Promise<FeatureOcrDiagnostics> {
  const supplied = boundOcrSegments(input.segments ?? []);
  if (supplied.length) return { status: "completed", segments: supplied, source: "musedam" };
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
    const frames = input.video?.frames ?? [];
    const count = Math.min(frames.length, MAX_VIDEO_OCR_FRAMES);
    const ocrFrames = Array.from(
      { length: count },
      (_, index) => frames[Math.round((index * (frames.length - 1)) / Math.max(1, count - 1))],
    );
    const { call, result } = await callFeatureLlm({
      context,
      kind: "ocr",
      model: ocrModel,
      messages: buildOcrMessages(
        ocrFrames.length ? ocrFrames.map((frame) => frame.image) : input.sourceImage,
      ),
      parse: (text) =>
        parseOcrResponse(text, ocrFrames.length || 1, { allowUnattributed: ocrFrames.length > 1 }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const segments = boundOcrSegments(
      result?.unattributedSegments ??
        result?.content.flatMap((group, index) =>
          ocrFrames.length
            ? group
                .filter((text) => text.trim())
                .map((text) => `[${ocrFrames[index].timestamp.toFixed(2)}s] ${text}`)
            : group,
        ) ??
        [],
    );
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
    video?: FeatureVideoEvidence;
    signal?: AbortSignal;
  },
): Promise<FeatureDecisionDiagnostics> {
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
  const diagnosticsMode = {
    mode: "llm" as const,
    decisionInputMode: imageMode ? ("image" as const) : ("text" as const),
  };
  if (!input.sourceImage.trim() && (imageMode || !input.video)) {
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

  if (input.signal?.aborted) {
    return {
      ...diagnosticsMode,
      ocr,
      decision: {
        status: "failed",
        error: "Video classification exceeded its processing deadline",
      },
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
  const chunks = batchFeatureCandidates(input.candidates);
  const work = pLimit(2);
  const batches = await Promise.all(
    chunks.map((candidates) =>
      work(async () => {
        const { call, result } = await callFeatureLlm({
          context,
          kind: "decision",
          model: process.env.FEATURE_DECISION_MODEL?.trim() ?? "",
          messages: buildFeatureDecisionMessages({ ...input, candidates, contextCandidates: input.candidates, imageMode, ocr }),
          parse: (text) => parseFeatureDecisionResponse(text, candidates, imageMode),
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return { candidateIds: candidates.map((candidate) => candidate.candidateId), call, result };
      }),
    ),
  );
  const successful = batches.filter((batch) => batch.call.status === "completed" && batch.result);
  const matches = successful.flatMap((batch) => batch.result!.matches);
  const failed = batches.length - successful.length;
  const completed = successful.length > 0 && failed === 0;
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

/** Keep a bounded group of competing identities together instead of letting
 * unrelated Logo/IP references consume its comparison slots. */
export function batchFeatureCandidates(candidates: FeatureDecisionCandidate[]): FeatureDecisionCandidate[][] {
  const groups = new Map<string, FeatureDecisionCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.featureType) ?? [];
    group.push(candidate);
    groups.set(candidate.featureType, group);
  }
  const batches: FeatureDecisionCandidate[][] = [];
  for (const group of groups.values()) {
    for (let start = 0; start < group.length; start += MAX_FEATURE_REFERENCES) {
      const block = group.slice(start, start + MAX_FEATURE_REFERENCES);
      const previous = batches.at(-1);
      const containsProduct = block.some(candidate => candidate.featureType === "product") ||
        previous?.some(candidate => candidate.featureType === "product");
      if (previous && !containsProduct && previous.length + block.length <= MAX_FEATURE_REFERENCES) previous.push(...block);
      else batches.push(block);
    }
  }
  return batches;
}
