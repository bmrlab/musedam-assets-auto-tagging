import {
  extractFeatureLlmUsage,
  getUnavailableFeatureLlmCosts,
  parseFeatureDecisionResponse,
  parseLlmJson,
  parseOcrResponse,
} from "@/lib/feature-decision/parsing";
import {
  boundOcrSegments,
  buildFeatureDecisionPrompt,
  buildOcrMessages,
} from "@/lib/feature-decision/prompts";
import type { FeatureDecisionCandidate } from "@/lib/feature-decision/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createCall } = vi.hoisted(() => ({ createCall: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { featureLlmCall: { create: createCall } } }));

const candidate: FeatureDecisionCandidate = {
  candidateId: "product:8b2dca40-147e-4998-9e21-188f878e41a0",
  featureType: "product",
  classId: "example",
  name: "Model A",
  typeName: "Bottle",
  description: "30 ml",
  referenceImage: "data:image/jpeg;base64,reference",
  similarity: 0.8,
};
const match = {
  candidateId: "C1",
  confidence: 91,
  reason: "The visible model and shape agree.",
  evidence: ["visual", "ocr"],
  conflicts: [],
  specificityLimit: null,
};
const validDecision = { outcome: "matched", matches: [match] };
const candidateIdsByReference = new Map([["C1", candidate.candidateId]]);
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
          candidateId: "C2",
          confidence: 0,
          evidence: ["retrieval"],
          conflicts: ["Filename suggests another variant"],
          specificityLimit: "Capacity unreadable",
        },
      ];
      const result = parseFeatureDecisionResponse(
        JSON.stringify({ outcome: "matched", matches: alternatives }),
        new Map([...candidateIdsByReference, ["C2", "product:alternative"]]),
        imageMode,
      );
      expect(result.matches).toEqual([
        { ...alternatives[0], candidateId: candidate.candidateId },
        { ...alternatives[1], candidateId: "product:alternative" },
      ]);
      const { messages } = buildFeatureDecisionPrompt({
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
    expect(() => parseOcrResponse('{"content":[["wrong"],[]]}', 3)).toThrow();
    expect(() => parseOcrResponse('{"content":["not an array"]}', 2)).toThrow();
    expect(boundOcrSegments(["原文", "原文", " ", "30 ml"])).toEqual(["原文", "30 ml"]);
  });

  it.each([false, true])("accepts the flat LANEIGE OCR response (fenced=%s)", (fenced) => {
    const segments = [
      "LANEIGE",
      "LIP SLEEPING MASK",
      "MASQUE DE NUIT POUR LES LÈVRES",
      "ACAI MANGO SMOOTHIE",
      "SMOOTHIE ACAI MANGUE",
      "Net wt. 0.70 oz / Poids net 20 g",
    ];
    const json = JSON.stringify({ content: segments });
    const response = fenced ? `\`\`\`json\n${json}\n\`\`\`` : json;
    expect(parseOcrResponse(response)).toEqual({ content: [segments] });
    expect(() => parseOcrResponse(response, 2)).toThrow();
  });

  it("normalizes mixed flat OCR segments while rejecting invalid text values", () => {
    expect(parseOcrResponse('{"content":["LANEIGE",{"text":"20 g"}]}')).toEqual({
      content: [["LANEIGE", "20 g"]],
    });
    expect(parseOcrResponse('{"content":[]}')).toEqual({ content: [[]] });
    for (const content of [["LANEIGE", 123], [null], [{ text: false }]]) {
      expect(() => parseOcrResponse(JSON.stringify({ content }))).toThrow();
    }
  });

  it.each([false, true])(
    "repairs the cleanser response's missing closing bracket (fenced=%s)",
    (fenced) => {
      const malformed =
        '{"content":[["LANEIGE", "WATER BANK", "Gentle Gel Cleanser", "For Normal To Oily Skin", "10 ml / 0.33 fl. oz."]}';
      const content = fenced ? `\`\`\`json\n${malformed}\n\`\`\`` : malformed;
      expect(parseOcrResponse(content)).toEqual({
        content: [
          [
            "LANEIGE",
            "WATER BANK",
            "Gentle Gel Cleanser",
            "For Normal To Oily Skin",
            "10 ml / 0.33 fl. oz.",
          ],
        ],
      });
      // Structural recovery is exclusive to OCR, not classification decisions.
      expect(() => parseLlmJson(content)).toThrow();
    },
  );

  it.each(['{"content":[["LANEIGE"}', '{"content":[["LANEIGE"]', '{"content":[["LANEIGE"'])(
    "recovers missing OCR container closers: %s",
    (content) => {
      expect(parseOcrResponse(content)).toEqual({ content: [["LANEIGE"]] });
    },
  );

  it("preserves literal brackets, escaped quotes, and backslashes during OCR recovery", () => {
    const segments = ["Label [A] {B}", 'Say "hello"', "C:\\label\\", 'Ends with \\"quote"'];
    const malformed = JSON.stringify({ content: [segments] }).replace(/\]\}$/, "}");
    expect(parseOcrResponse(malformed)).toEqual({ content: [segments] });
  });

  it.each([
    '{"content":[["unfinished',
    '{"content":[["LANEIGE",}',
    '{"content":[["LANEIGE" "WATER BANK"]]}',
    '{"content":}',
    '{"content":[[123]}',
    '{"content":[["LANEIGE"]]}}',
  ])("rejects OCR errors that require guessing text or values: %s", (content) => {
    expect(() => parseOcrResponse(content)).toThrow();
  });

  it.each(["```json\n%s\n```", "```\r\n%s\r\n```", "Here is the JSON:\n```JSON\n%s\n```\nDone."])(
    "recovers single-image product groups from Markdown: %s",
    (wrapper) => {
      const groups = [
        [
          "Sulwhasoo",
          "ESSENTIAL REVITALIZING",
          "WATER EX",
          "LOTION TONIQUE REVITALISANTE",
          "ESSENTIEL EX",
        ],
        [
          "Sulwhasoo",
          "ESSENTIAL REVITALIZING",
          "EMULSION EX",
          "ÉMULSION REVITALISANTE",
          "ESSENTIEL EX",
        ],
        ["Sulwhasoo", "ESSENTIAL FIRMING CREAM EX", "CRÈME RAFFERMISSANTE", "ESSENTIEL EX"],
      ];
      const content = wrapper.replace("%s", JSON.stringify({ content: groups }));
      expect(parseOcrResponse(content)).toEqual({ content: [groups.flat()] });
      expect(parseOcrResponse(content, 3)).toEqual({ content: groups });
      expect(() => parseOcrResponse(content, 2)).toThrow();
    },
  );

  it("rejects malformed or ambiguous Markdown and invalid OCR segments", () => {
    expect(() => parseLlmJson('```json\n{"content":\n```')).toThrow();
    expect(() => parseLlmJson("```json\n{}\n```\n```json\n{}\n```")).toThrow();
    expect(() => parseOcrResponse('{"content":[["valid"],[123]]}')).toThrow();
    expect(parseLlmJson('```json {"content":[[]]} ```')).toEqual({ content: [[]] });
    expect(parseLlmJson('{"text":"literal ```json fence"}')).toEqual({
      text: "literal ```json fence",
    });
  });

  it("requires supplied IDs, finite confidence, and at least one candidate for a match", () => {
    expect(
      parseFeatureDecisionResponse(JSON.stringify(validDecision), candidateIdsByReference).matches[0],
    ).toEqual({ ...match, candidateId: candidate.candidateId });
    for (const invalid of [
      { ...validDecision, matches: [{ ...match, candidateId: "C2" }] },
      { ...validDecision, matches: [{ ...match, candidateId: candidate.candidateId }] },
      { ...validDecision, matches: [match, match] },
      { ...validDecision, matches: [{ ...match, confidence: 101 }] },
      { ...validDecision, matches: [{ ...match, confidence: "91" }] },
      { ...validDecision, matches: [] },
      { outcome: "no_match", matches: [{ ...match, candidateId: "C2" }] },
    ])
      expect(() => parseFeatureDecisionResponse(JSON.stringify(invalid), candidateIdsByReference)).toThrow();
    expect(() =>
      parseFeatureDecisionResponse('{"outcome":"ambiguous","matches":[]}', candidateIdsByReference),
    ).toThrow();
    expect(
      parseFeatureDecisionResponse('{"outcome":"no_match","matches":[]}', candidateIdsByReference).matches,
    ).toEqual([]);
  });

  it("keeps retrieval evidence and final confidence separate with labeled images", () => {
    const { messages } = buildFeatureDecisionPrompt({
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
    expect(text).toContain("candidateId: C1");
    expect(text).not.toContain(candidate.candidateId);
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
    const { messages } = buildFeatureDecisionPrompt({
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
      "C1",
      "TEXT ONLY",
    ])
      expect(text).toContain(value);
    for (const value of [
      candidate.candidateId,
      "private-source-image-marker",
      "data:image",
      "image_url",
      "referenceImageLabel",
      "The next image",
    ])
      expect(text).not.toContain(value);
    expect(() =>
      parseFeatureDecisionResponse(JSON.stringify(validDecision), candidateIdsByReference, false),
    ).toThrow("visual evidence");
    expect(
      parseFeatureDecisionResponse(
        JSON.stringify({
          ...validDecision,
          matches: [{ ...match, evidence: ["retrieval", "ocr"] }],
        }),
        candidateIdsByReference,
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
  it.each([0, 5])("completes a no-match decision with a rejected candidate scored %s", async (confidence) => {
    const modelResponse = JSON.stringify({
      outcome: "no_match",
      matches: [{ ...match, confidence, reason: "The visible brand differs from the reference." }],
    });
    const fetchMock = vi.fn().mockResolvedValue(response(modelResponse));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      imageMode: true,
      ocr: { status: "completed", segments: ["Other brand"] },
      candidates: [candidate],
    });

    expect(result.decision).toMatchObject({
      status: "completed",
      result: { outcome: "no_match", matches: [] },
      call: { response: modelResponse },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses flattened video OCR as text evidence without assigning frame timestamps", async () => {
    const flat = { content: [{ text: "Seoul Sunset\nLANEIGE\nLANEIGE\n200 kcal/70 ml" }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(`\`\`\`json\n${JSON.stringify(flat)}\n\`\`\``))
      .mockResolvedValueOnce(response('{"outcome":"no_match","matches":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "",
      imageMode: false,
      video: {
        sheetColumns: 4,
        frames: [0, 1, 2, 3].map((timestamp) => ({ image: `frame-${timestamp}`, timestamp })),
      },
      candidates: [candidate],
    });
    expect(result.ocr.status).toBe("completed");
    expect(result.ocr.segments).toEqual(["Seoul Sunset", "LANEIGE", "200 kcal/70 ml"]);
    expect(result.decision.status).toBe("completed");
    expect(result.decision.call?.request.messages[1].content).toContain(
      '"segments":["Seoul Sunset","LANEIGE","200 kcal/70 ml"]',
    );
  });

  it.each([true, false])("uses video OCR and respects imageMode=%s", async (imageMode) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('{"content":[[],["Model A"]]}'))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            ...validDecision,
            matches: [{ ...match, evidence: [imageMode ? "visual" : "retrieval", "ocr"] }],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: imageMode ? "video-contact-sheet" : "",
      imageMode,
      video: {
        sheetColumns: 2,
        frames: [
          { image: "frame-one", timestamp: 0 },
          { image: "frame-two", timestamp: 8 },
        ],
      },
      candidates: [{ ...candidate, sampleTimes: [8] }],
    });
    expect(result.ocr.segments).toEqual(["[8.00s] Model A"]);
    expect(result.decision.status).toBe("completed");
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request).toMatchObject({ enable_thinking: false, response_format: { type: "json_object" } });
    expect(request).not.toHaveProperty("reasoning_effort");
    expect(JSON.stringify(request)).toContain("[8.00s] Model A");
    expect(JSON.stringify(request)).not.toContain("frame-two");
    if (imageMode) {
      expect(request.messages[1].content[1]).toMatchObject({
        image_url: { url: "video-contact-sheet" },
      });
      expect(JSON.stringify(request)).toContain(candidate.referenceImage!);
    } else {
      expect(JSON.stringify(request)).not.toContain("image_url");
      expect(JSON.stringify(request)).not.toContain(candidate.referenceImage!);
    }
  });

  it("keeps OCR enabled but sends no source or reference images in the text-only decision request", async () => {
    const textDecision = {
      ...validDecision,
      matches: [{ ...match, evidence: ["retrieval", "filename", "ocr"] }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response('```json\n{"content":["Model A","30 ml"]}\n```'))
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
      decision: {
        status: "completed",
        result: {
          ...textDecision,
          matches: [{ ...textDecision.matches[0], candidateId: candidate.candidateId }],
        },
        call: { candidateIdsByReference: { C1: candidate.candidateId } },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ocrRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(ocrRequest).not.toHaveProperty("enable_thinking");
    expect(ocrRequest.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "source-only-ocr" },
    });
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.enable_thinking).toBe(false);
    expect(request).not.toHaveProperty("reasoning_effort");
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
      .mockResolvedValueOnce(response('```json\n{"content":[["Model A"],["30 ml"]}\n```'))
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
    expect(result.decision.result).toEqual({
      ...validDecision,
      matches: [{ ...match, candidateId: candidate.candidateId }],
    });
    expect(result.ocr.segments).toEqual(["Model A", "30 ml"]);
    expect(result.ocr.status).toBe("completed");
    const ocrMessages = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(ocrMessages[0].content).toContain("Do not use Markdown");
    expect(ocrMessages[0].content).toContain("one image showing three products");
    expect(ocrMessages[1].content[0].text).toContain("JSON only");
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
      .mockResolvedValueOnce(response('{"content":[["valid"],[123]]}'))
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

  it("reports when the video processing deadline interrupts a decision request", async () => {
    delete process.env.OCR_MODEL;
    const deadline = new AbortController();
    const fetchMock = vi.fn(async (_url: string, { signal }: RequestInit) => {
      deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      signal?.throwIfAborted();
    });
    vi.stubGlobal("fetch", fetchMock);
    const { runFeatureDecision } = await import("@/lib/feature-decision/service");
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "",
      imageMode: false,
      video: { frames: [{ image: "frame", timestamp: 0 }], sheetColumns: 1 },
      candidates: [candidate],
      signal: deadline.signal,
    });
    expect(result.decision.error).toBe(
      "Video processing deadline expired during the feature decision request",
    );
    expect(result.decision.status).toBe("failed");
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
