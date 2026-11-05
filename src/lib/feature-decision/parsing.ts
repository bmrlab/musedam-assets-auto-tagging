import { z } from "zod";
import type {
  FeatureDecisionCandidate,
  FeatureDecisionResponse,
  FeatureLlmCosts,
  FeatureLlmUsage,
  OcrResponse,
  OpenAIChatResponse,
} from "./types";

const tokenCountSchema = z.number().int().nonnegative().optional();
const chatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          role: z.string().optional(),
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: tokenCountSchema,
      completion_tokens: tokenCountSchema,
      total_tokens: tokenCountSchema,
      prompt_tokens_details: z
        .object({ cached_tokens: tokenCountSchema, image_tokens: tokenCountSchema })
        .optional(),
      completion_tokens_details: z
        .object({ reasoning_tokens: tokenCountSchema, text_tokens: tokenCountSchema })
        .optional(),
    })
    .optional(),
});

export function parseChatEnvelope(value: unknown): OpenAIChatResponse {
  return chatResponseSchema.parse(value);
}

/** Some compatible gateways wrap their otherwise valid JSON in a single code fence. */
export function parseLlmJson(content: string): unknown {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")
    .trim();
  return JSON.parse(text);
}

export function parseOcrResponse(content: string, imageCount = 1): OcrResponse {
  const textBlock = z.object({ text: z.string() });
  const segment = z.union([z.string(), textBlock.transform((block) => block.text)]);
  let payload = parseLlmJson(content);
  // Some OCR gateways return a flat list of text blocks for a single source image.
  // Only unwrap that variant when image association is unambiguous; never regroup
  // flat blocks from a multi-image request or coerce malformed text values.
  if (imageCount === 1) {
    const flatBlocks = z
      .object({ content: z.array(textBlock) })
      .strict()
      .safeParse(payload);
    if (flatBlocks.success) {
      payload = { content: [flatBlocks.data.content.map((block) => block.text)] };
    }
  }
  return z
    .object({ content: z.array(z.array(segment)).length(imageCount) })
    .strict()
    .parse(payload);
}

const decisionResponseSchema = z
  .object({
    outcome: z.enum(["matched", "no_match"]),
    matches: z
      .array(
        z
          .object({
            candidateId: z.string().min(1),
            confidence: z.number().min(0).max(100),
            reason: z.string().min(1).max(3000),
            evidence: z
              .array(z.enum(["visual", "retrieval", "filename", "path", "ocr"]))
              .min(1)
              .max(5),
            conflicts: z.array(z.string()).max(20),
            specificityLimit: z.string().nullable(),
          })
          .strict(),
      )
      .max(15),
  })
  .strict();

export function parseFeatureDecisionResponse(
  content: string,
  candidates: Pick<FeatureDecisionCandidate, "candidateId">[],
  imageMode = true,
): FeatureDecisionResponse {
  const result = decisionResponseSchema.parse(parseLlmJson(content));
  const allowed = new Set(candidates.map((candidate) => candidate.candidateId));
  const seen = new Set<string>();
  for (const match of result.matches) {
    if (!imageMode && match.evidence.includes("visual"))
      throw new Error("Text-only feature decisions cannot claim direct visual evidence");
    if (!allowed.has(match.candidateId))
      throw new Error(`Unknown feature candidate ID: ${match.candidateId}`);
    if (seen.has(match.candidateId))
      throw new Error(`Duplicate feature candidate ID: ${match.candidateId}`);
    seen.add(match.candidateId);
  }
  const hasMatches = result.matches.length > 0;
  if ((result.outcome === "matched") !== hasMatches) {
    throw new Error("Feature outcome contradicts the returned matches");
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tokenCount(value: unknown): number | null {
  const parsed = tokenCountSchema.safeParse(value);
  return parsed.success ? (parsed.data ?? null) : null;
}

/** Usage is independent of answer validation: malformed choices may still incur a charge. */
export function extractFeatureLlmUsage(response?: unknown): FeatureLlmUsage {
  const usage = record(record(response).usage);
  const inputTokens = tokenCount(usage.prompt_tokens);
  const outputTokens = tokenCount(usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      tokenCount(usage.total_tokens) ??
      (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    cachedInputTokens: tokenCount(record(usage.prompt_tokens_details).cached_tokens),
    reasoningTokens: tokenCount(record(usage.completion_tokens_details).reasoning_tokens),
    imageTokens: tokenCount(record(usage.prompt_tokens_details).image_tokens),
  };
}

/** Monetary accounting is unavailable until pricing is implemented. Token usage is retained. */
export function getUnavailableFeatureLlmCosts(): FeatureLlmCosts {
  return {
    currency: "USD",
    inputCost: null,
    outputCost: null,
    totalCost: null,
    inputPricePerMillion: null,
    cachedInputPricePerMillion: null,
    outputPricePerMillion: null,
  };
}
