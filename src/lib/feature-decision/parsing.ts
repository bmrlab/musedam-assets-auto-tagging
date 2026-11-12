import { z } from "zod";
import type {
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

function unwrapLlmJson(content: string): string {
  const text = content.trim();
  try {
    JSON.parse(text);
    return text;
  } catch {
    const blocks = [
      ...text.matchAll(
        /(?:^|\n)[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?=\r?\n|$)/gi,
      ),
    ];
    if (blocks.length === 1) return blocks[0][1];
    // Retain support for gateways that put the entire fence on one line.
    const inline = text.match(/^```(?:json)?\s*([^\n]*?)\s*```$/i);
    if (inline) return inline[1];
    return text;
  }
}

/** Accept raw JSON first, then a single Markdown JSON block. */
export function parseLlmJson(content: string): unknown {
  return JSON.parse(unwrapLlmJson(content));
}

/** OCR-only fallback: insert missing container closers, never modify text or values. */
function parseOcrJson(content: string): unknown {
  const text = unwrapLlmJson(content);
  try {
    return JSON.parse(text);
  } catch (error) {
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    let repaired = "";
    for (const character of text) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') {
        quoted = true;
      } else if (character === "[" || character === "{") {
        stack.push(character === "[" ? "]" : "}");
      } else if (character === "]" || character === "}") {
        // A model may close the object before closing its content arrays.
        while (character === "}" && stack.at(-1) === "]") {
          repaired += stack.pop();
        }
        if (stack.pop() !== character) throw error;
      }
      repaired += character;
    }
    // Never invent the rest of a cut-off string. JSON.parse still rejects missing
    // values, separators, trailing commas, and every other syntax error.
    if (quoted) throw error;
    repaired += stack.reverse().join("");
    return JSON.parse(repaired);
  }
}

export function parseOcrResponse(
  content: string,
  imageCount = 1,
  { allowUnattributed = false }: { allowUnattributed?: boolean } = {},
): OcrResponse {
  const textBlock = z.object({ text: z.string() });
  const segment = z.union([z.string(), textBlock.transform((block) => block.text)]);
  const payload = parseOcrJson(content);
  if (imageCount === 1 || allowUnattributed) {
    const flatBlocks = z
      .object({ content: z.array(segment) })
      .strict()
      .safeParse(payload);
    if (flatBlocks.success) {
      if (imageCount === 1) return { content: [flatBlocks.data.content] };
      // A flat response has no frame boundaries, even if its length equals the frame count.
      return {
        content: [],
        unattributedSegments: flatBlocks.data.content.flatMap((text) => text.split(/\r?\n/)),
      };
    }
  }
  const parsed = z
    .object({ content: z.array(z.array(segment)) })
    .strict()
    .parse(payload);
  // A single image may contain several products or text regions. Some models
  // incorrectly group those as separate images; all still belong to this source.
  if (imageCount === 1) return { content: [parsed.content.flat()] };
  z.array(z.array(z.string())).length(imageCount).parse(parsed.content);
  return parsed;
}

function featureDecisionResponseSchema(candidateId: z.ZodType<string>) {
  return z.strictObject({
    outcome: z.enum(["matched", "no_match"]),
    matches: z.array(z.strictObject({
      candidateId,
      confidence: z.number().min(0).max(100),
      reason: z.string().min(1).max(3000),
      evidence: z.array(z.enum(["visual", "retrieval", "filename", "path", "ocr"])).min(1).max(5),
      conflicts: z.array(z.string()).max(20),
      specificityLimit: z.string().nullable(),
    })).max(15),
  });
}

const decisionResponseSchema = featureDecisionResponseSchema(z.string().min(1));

export function buildFeatureDecisionJsonSchema(references: string[]) {
  return z.toJSONSchema(featureDecisionResponseSchema(z.enum(references)), { target: "draft-7" });
}

export function parseFeatureDecisionResponse(
  content: string,
  candidateIdsByReference: ReadonlyMap<string, string>,
  imageMode = true,
): FeatureDecisionResponse {
  const { outcome, matches } = decisionResponseSchema.parse(parseLlmJson(content));
  if ((outcome === "matched") !== (matches.length > 0)) {
    throw new Error("Feature outcome contradicts the returned matches");
  }
  const seen = new Set<string>();
  return {
    outcome,
    matches: matches.map((match) => {
      if (!imageMode && match.evidence.includes("visual"))
        throw new Error("Text-only feature decisions cannot claim direct visual evidence");
      const candidateId = candidateIdsByReference.get(match.candidateId);
      if (candidateId === undefined)
        throw new Error(`Unknown feature candidate reference: ${match.candidateId}`);
      if (seen.has(candidateId))
        throw new Error(`Duplicate feature candidate reference: ${match.candidateId}`);
      seen.add(candidateId);
      return { ...match, candidateId };
    }),
  };
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
