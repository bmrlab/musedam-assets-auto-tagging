// @vitest-environment node
import { runFeatureDecision } from "@/lib/feature-decision/service";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { featureLlmCall: { create: state.create } } }));
const candidates = Array.from({ length: 34 }, (_, i) => ({
  candidateId: `product:${i}`,
  classId: String(i),
  featureType: "product" as const,
  name: `Product ${i}`,
  typeName: "Product",
  similarity: 0.9,
}));
const envelope = (value: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  );
beforeEach(() => {
  vi.stubEnv("OPENAI_BASE_URL", "https://model.test/v1");
  vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubEnv("OCR_MODEL", "ocr");
  vi.stubEnv("FEATURE_DECISION_MODEL", "decision");
  state.create.mockReset();
  state.create.mockResolvedValue({ id: "call" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("bounded feature decision batches", () => {
  it("assesses every candidate with one OCR call and at most two decision calls in flight", async () => {
    let active = 0,
      max = 0,
      ocr = 0;
    const sizes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const request = JSON.parse(options.body);
        if (request.model === "ocr") {
          ocr++;
          return envelope({ content: [["Product label"]] });
        }
        const text = request.messages[1].content;
        const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        sizes.push(data.candidates.length);
        active++;
        max = Math.max(max, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return envelope({
          outcome: "matched",
          matches: data.candidates.map((c: { candidateId: string }) => ({
            candidateId: c.candidateId,
            confidence: 91,
            reason: "Matching identity",
            evidence: ["retrieval"],
            conflicts: [],
            specificityLimit: null,
          })),
        });
      }),
    );
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      imageMode: false,
      candidates,
    });
    expect(ocr).toBe(1);
    expect(sizes).toEqual([15, 15, 4]);
    expect(max).toBe(2);
    expect(result.decision.result?.matches.map((m) => m.candidateId)).toEqual(
      candidates.map((c) => c.candidateId),
    );
    expect(result.decision.result?.matches.every((m) => m.confidence === 91)).toBe(true);
    expect(result.decision.batches).toHaveLength(3);
    expect(state.create).toHaveBeenCalledTimes(4);
  });
  it("retains successful predictions and explicitly records a failed batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const request = JSON.parse(options.body);
        if (request.model === "ocr") return envelope({ content: [[]] });
        const text = request.messages[1].content;
        const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        if (data.candidates[0].candidateId === "product:15")
          return new Response("unavailable", { status: 503 });
        return envelope({
          outcome: "matched",
          matches: [
            {
              candidateId: "product:0",
              confidence: 87,
              reason: "Matching identity",
              evidence: ["retrieval"],
              conflicts: [],
              specificityLimit: null,
            },
          ],
        });
      }),
    );
    const result = await runFeatureDecision({
      teamId: 1,
      sourceImage: "source",
      imageMode: false,
      candidates: candidates.slice(0, 20),
    });
    expect(result.decision.status).toBe("completed");
    expect(result.decision.result?.matches).toHaveLength(1);
    expect(result.decision.batches?.[1].status).toBe("failed");
    expect(result.decision.batches?.[1].candidateIds).toEqual(
      candidates.slice(15, 20).map((c) => c.candidateId),
    );
    expect(result.decision.error).toContain("1 of 2");
  });
});
