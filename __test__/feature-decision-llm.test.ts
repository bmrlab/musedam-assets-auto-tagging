import {
  extractFeatureLlmUsage,
  getUnavailableFeatureLlmCosts,
  parseFeatureDecisionResponse,
  parseOcrResponse,
} from "@/lib/feature-decision/parsing";
import {
  boundOcrSegments,
  buildFeatureDecisionMessages,
  buildOcrMessages,
} from "@/lib/feature-decision/prompts";
import type { FeatureDecisionCandidate } from "@/lib/feature-decision/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createCall } = vi.hoisted(() => ({ createCall: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { featureLlmCall: { create: createCall } } }));

const candidate: FeatureDecisionCandidate = {
  candidateId: "product:example",
  featureType: "product",
  classId: "example",
  name: "Model A",
  typeName: "Bottle",
  description: "30 ml",
  referenceImage: "data:image/jpeg;base64,reference",
  similarity: 0.8,
};
const match = {
  candidateId: candidate.candidateId,
  confidence: 91,
  reason: "The visible model and shape agree.",
  evidence: ["visual", "ocr"],
  conflicts: [],
  specificityLimit: null,
};
const validDecision = { outcome: "matched", matches: [match] };
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...originalEnv,
    OPENAI_BASE_URL: "https://gateway.example/v1/",
    OPENAI_API_KEY: "secret-key",
    OCR_MODEL: "ocr-model",
    FEATURE_DECISION_MODEL: "decision-model",
    DECISION_LLM_IMAGE_USE: "true",
  };
  createCall.mockResolvedValue({ id: "call-id" });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("feature LLM response contracts", () => {
  it.each([true, false])(
    "accepts multiple low-confidence alternatives with limitations in imageMode=%s",
    (imageMode) => {
      const alternatives = [
        {
          ...match,
          confidence: 43,
          evidence: ["retrieval", "ocr"],
          specificityLimit: "Series supported, SKU unresolved",
        },
        {
          ...match,
          candidateId: "product:alternative",
          confidence: 0,
          evidence: ["retrieval"],
          conflicts: ["Filename suggests another variant"],
          specificityLimit: "Capacity unreadable",
        },
      ];
      const result = parseFeatureDecisionResponse(
        JSON.stringify({ outcome: "matched", matches: alternatives }),
        [candidate, { candidateId: "product:alternative" }],
        imageMode,
      );
      expect(result.matches).toEqual(alternatives);
      const messages = buildFeatureDecisionMessages({
        sourceImage: "source",
        imageMode,
        ocr: { status: "empty", segments: [] },
        candidates: [candidate],
      });
      const prompt = String(messages[0].content);
      expect(prompt).not.toContain('"ambiguous"');
      expect(prompt).toContain("even if every score is low");
      expect(prompt).toContain("all supplied candidates are clearly unrelated");
      expect(prompt).toContain('"confidence":43');
      expect(prompt).not.toContain("accepted matches only");
    },
  );

  it("normalizes single-image OCR text blocks without guessing image associations", () => {
    expect(parseOcrResponse('{"content":[{"text":"Sulwhasoo"}]}')).toEqual({
      content: [["Sulwhasoo"]],
    });
    expect(parseOcrResponse('{"content":[{"text":"Sulwhasoo"},{"text":"30 ml"}]}')).toEqual({
      content: [["Sulwhasoo", "30 ml"]],
    });
    expect(parseOcrResponse('{"content":[[{"text":"First"}], [{"text":"Second"}]]}', 2)).toEqual({
      content: [["First"], ["Second"]],
    });
    expect(() => parseOcrResponse('{"content":[{"text":"First"},{"text":"Second"}]}', 2)).toThrow();
    expect(() => parseOcrResponse('{"content":[{"text":123}]}')).toThrow();
    expect(() => parseOcrResponse('{"content":[{}]}')).toThrow();
  });

  it("accepts fenced OCR JSON and preserves per-image association", () => {
    expect(parseOcrResponse('```json\n{"content":[["原文 30 ml"],[]]}\n```', 2)).toEqual({
      content: [["原文 30 ml"], []],
    });
    expect(() => parseOcrResponse('{"content":[["wrong"],[]]}', 1)).toThrow();
    expect(() => parseOcrResponse('{"content":["not an array"]}')).toThrow();
    expect(boundOcrSegments(["原文", "原文", " ", "30 ml"])).toEqual(["原文", "30 ml"]);
  });

  it("accepts only supplied IDs with finite confidence and consistent outcomes", () => {
    expect(
      parseFeatureDecisionResponse(JSON.stringify(validDecision), [candidate]).matches[0]
        .confidence,
    ).toBe(91);
    for (const invalid of [
      { ...validDecision, matches: [{ ...match, candidateId: "invented" }] },
      { ...validDecision, matches: [match, match] },
      { ...validDecision, matches: [{ ...match, confidence: 101 }] },
      { ...validDecision, matches: [{ ...match, confidence: "91" }] },
      { ...validDecision, matches: [] },
      { ...validDecision, outcome: "no_match" },
    ])
      expect(() => parseFeatureDecisionResponse(JSON.stringify(invalid), [candidate])).toThrow();
    expect(() =>
      parseFeatureDecisionResponse('{"outcome":"ambiguous","matches":[]}', [candidate]),
    ).toThrow();
    expect(
      parseFeatureDecisionResponse('{"outcome":"no_match","matches":[]}', [candidate]).matches,
    ).toEqual([]);
  });

  it("keeps retrieval evidence and final confidence separate with labeled images", () => {
    const messages = buildFeatureDecisionMessages({
      sourceImage: "source",
      fileName: "中文型号.jpg",
      folderPath: "/产品/中文型号.jpg",
      ocr: { status: "completed", segments: ["30 ml"] },
      candidates: [candidate],
    });
    const text = JSON.stringify(messages);
    expect(text).toContain("中文型号.jpg");
    expect(text).toContain("SOURCE ASSET");
    expect(text).toContain("REFERENCE 1");
    expect(text).not.toContain("xMin");
    const imageParts = messages.flatMap((message) =>
      typeof message.content === "string"
        ? []
        : message.content.filter((part) => part.type === "image_url"),
    );
    expect(imageParts).toHaveLength(2);
    expect(JSON.stringify(buildOcrMessages("source"))).toContain("content");
  });

  it("sends only curated text evidence to the text-only decision model", () => {
    const messages = buildFeatureDecisionMessages({
      imageMode: false,
      sourceImage: "private-source-image-marker",
      fileName: "Model A.jpg",
      folderPath: "/Product/Model A",
      ocr: { status: "completed", segments: ["30 ml"] },
      candidates: [candidate],
    });
    expect(messages.every((message) => typeof message.content === "string")).toBe(true);
    const text = JSON.stringify(messages);
    for (const value of [
      "Model A.jpg",
      "/Product/Model A",
      "30 ml",
      "0.8",
      "product:example",
      "TEXT ONLY",
    ])
      expect(text).toContain(value);
    for (const value of [
      "private-source-image-marker",
      "data:image",
      "image_url",
      "referenceImageLabel",
      "The next image",
    ])
      expect(text).not.toContain(value);
    expect(() =>
      parseFeatureDecisionResponse(JSON.stringify(validDecision), [candidate], false),
    ).toThrow("visual evidence");
    expect(
      parseFeatureDecisionResponse(
        JSON.stringify({
          ...validDecision,
          matches: [{ ...match, evidence: ["retrieval", "ocr"] }],
        }),
        [candidate],
        false,
      ).matches,
    ).toHaveLength(1);
  });

  it("retains token usage while monetary costs are unavailable", () => {
    expect(extractFeatureLlmUsage().totalTokens).toBeNull();
    expect(
      extractFeatureLlmUsage({ usage: { prompt_tokens: 1000, completion_tokens: 100 } })
        .totalTokens,
    ).toBe(1100);
    expect(getUnavailableFeatureLlmCosts()).toMatchObject({
      inputCost: null,
      outputCost: null,
      totalCost: null,
    });
  });
});

function response(content: string, total = 25): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: total },
    }),
    { status: 200 },
  );
}

describe("single-attempt feature OCR and decision gateway", () => {
  it("keeps OCR enabled but sends no source or reference images in the text-only decision request", async () => {
    const textDecision = {
      ...validDecision,
      matches: [{ ...match, evidence: ["retrieval", "filename", "ocr"] }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('{"content":[["Model A","30 ml"]]}'))
      .mockResolvedValueOnce(response(JSON.stringify(textDecision)));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source-only-ocr",
      imageMode: false,
      fileName: "Model A.jpg",
      candidates: [{ ...candidate, referenceImage: undefined }],
    });
    expect(result).toMatchObject({
      mode: "llm",
      decisionInputMode: "text",
      ocr: { status: "completed", segments: ["Model A", "30 ml"] },
      decision: { status: "completed", result: textDecision },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ocrRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(ocrRequest.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "source-only-ocr" },
    });
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(
      request.messages.every(
        (message: { content: unknown }) => typeof message.content === "string",
      ),
    ).toBe(true);
    expect(JSON.stringify(request)).not.toContain("source-only-ocr");
    expect(JSON.stringify(request)).not.toContain("image_url");
    expect(request.messages[1].content).toContain("30 ml");
    expect(createCall).toHaveBeenCalledTimes(2);
    expect(createCall.mock.calls[1][0].data.request).toEqual(request);
    expect(createCall.mock.calls[1][0].data).toMatchObject({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      status: "completed",
    });
  });

  it("calls the configured gateway for OCR and one combined decision and persists both usages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('```json\n{"content":[["Model A","30 ml"]]}\n```'))
      .mockResolvedValueOnce(response(JSON.stringify(validDecision)));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      queueItemId: 2,
      assetObjectId: 3,
      sourceImage: "source",
      fileName: "Model A.jpg",
      candidates: [candidate],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.example/v1/chat/completions");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("ocr-model");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("decision-model");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[1].content[0].text).toContain(
      "30 ml",
    );
    expect(result.decision.result).toEqual(validDecision);
    expect(result.ocr.segments).toEqual(["Model A", "30 ml"]);
    expect(createCall).toHaveBeenCalledTimes(2);
    expect(createCall.mock.calls[1][0].data).toMatchObject({
      teamId: 1,
      queueItemId: 2,
      assetObjectId: 3,
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      status: "completed",
    });
    expect(JSON.stringify(createCall.mock.calls)).not.toContain("secret-key");
  });

  it("continues with OCR failure but never retries an invalid decision or fabricates matches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('{"content":[["mismatched"],[]]}'))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({ ...validDecision, matches: [{ ...match, candidateId: "unknown" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      candidates: [candidate],
    });
    expect(result.ocr.status).toBe("failed");
    expect(result.decision.status).toBe("failed");
    expect(result.decision.result).toBeUndefined();
    expect(result.decision.call?.usage.totalTokens).toBe(25);
    expect(result.decision.call?.response).toContain("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createCall.mock.calls[1][0].data.status).toBe("failed");
  });

  it("skips calls without a source and skips decision when no references survive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('{"content":[[]]}'));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    expect(
      (await runFeatureDecision({ teamId: 1, sourceImage: "", candidates: [candidate] })).decision
        .status,
    ).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    const empty = await runFeatureDecision({ teamId: 1, sourceImage: "source", candidates: [] });
    expect(empty.ocr.status).toBe("empty");
    expect(empty.decision.status).toBe("skipped");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records gateway HTTP failure and exposes accounting persistence failure without a paid retry", async () => {
    delete process.env.OCR_MODEL;
    createCall.mockRejectedValue(new Error("accounting unavailable"));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      candidates: [candidate],
    });
    expect(result.ocr.status).toBe("disabled");
    expect(result.decision.status).toBe("failed");
    expect(result.decision.call?.persistenceError).toBe("accounting unavailable");
    expect(result.decision.call?.usage.inputTokens).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attempts a timed-out decision once and persists the failure", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    delete process.env.OCR_MODEL;
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Request deadline exceeded", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      candidates: [candidate],
    });
    expect(result.decision.status).toBe("failed");
    expect(result.decision.result).toBeUndefined();
    expect(result.decision.error).toContain("deadline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createCall.mock.calls[0][0].data.status).toBe("failed");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(300_000);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(8192);
  });

  it("retains token usage from a truncated answer without a repair call", async () => {
    delete process.env.OCR_MODEL;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "length", message: { content: '{"outcome":' } }],
          usage: { prompt_tokens: 25, completion_tokens: 8192, total_tokens: 8217 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      candidates: [candidate],
    });
    expect(result.decision.status).toBe("failed");
    expect(result.decision.call?.usage.totalTokens).toBe(8217);
    expect(result.decision.error).toContain("truncated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accounts for supplied usage even when the chat response envelope is invalid", async () => {
    delete process.env.OCR_MODEL;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      candidates: [candidate],
    });
    expect(result.decision.status).toBe("failed");
    expect(result.decision.call?.usage.totalTokens).toBe(120);
    expect(createCall.mock.calls[0][0].data).toMatchObject({ totalTokens: 120, status: "failed" });
  });
});
