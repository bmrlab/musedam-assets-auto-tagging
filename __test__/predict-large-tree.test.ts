import { predictAssetTags } from "@/app/(tagging)/predict";
import type { AssetObject, TagWithChildren } from "@/prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: (name: string) => ({ name }) }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateObject: mocks.generate,
}));

const asset: AssetObject = {
  id: 1,
  slug: "a/1",
  tags: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  teamId: 1,
  name: "needle_target",
  description: "",
  materializedPath: "",
  content: { aiDescription: "HiddenContentSource" },
  extra: { extension: "png" },
};
function tags(): TagWithChildren[] {
  return [
    {
      id: 1,
      name: "产品",
      extra: { evidencePolicy: "content", siblingsExclusive: false },
      children: Array.from({ length: 1200 }, (_, i) => ({
        id: i + 2,
        name: i === 1199 ? "needle_target" : `tag_${i}`,
        extra: { evidencePolicy: "content", keywords: ["ConfiguredKeywordSecret"] },
      })),
    },
  ];
}
beforeEach(() => {
  mocks.generate.mockReset().mockImplementation(async ({ schemaName }) =>
    schemaName === "TagPredictions"
      ? {
          object: {
            predictions: [
              {
                source: "basicInfo",
                tags: [{ leafTagId: 1201, tagPath: ["产品", "needle_target"], confidence: 0.99 }],
              },
            ],
          },
          usage: {},
        }
      : { object: { terms: ["needle_target"] } },
  );
});
it("runs prediction on bounded candidates and respects disabled input sources", async () => {
  const result = await predictAssetTags(asset, {
    tagsTree: tags(),
    matchingSources: {
      basicInfo: true,
      materializedPath: false,
      contentAnalysis: false,
      tagKeywords: false,
    },
  });
  expect(result.tagsWithScore.some((tag) => tag.leafTagId === 1201)).toBe(true);
  expect(result.extra.candidateSelection?.selected).toBeLessThanOrEqual(1000);
  expect(result.extra.evidencePoliciesPending).toBe(false);
  const expansion = mocks.generate.mock.calls[0][0];
  expect(expansion.prompt).not.toContain("HiddenContentSource");
  const prediction = mocks.generate.mock.calls.find(
    ([args]) => args.schemaName === "TagPredictions",
  )![0];
  const input = JSON.stringify(prediction.messages);
  expect(input.length).toBeLessThan(70000);
  expect(input).not.toContain("ConfiguredKeywordSecret");
  expect(input).not.toContain("HiddenContentSource");
});
it("continues with lexical candidates when semantic query expansion fails", async () => {
  mocks.generate.mockRejectedValueOnce(new Error("semantic unavailable"));
  const result = await predictAssetTags(asset, {
    tagsTree: tags(),
    matchingSources: {
      basicInfo: true,
      materializedPath: false,
      contentAnalysis: false,
      tagKeywords: false,
    },
  });
  expect(result.tagsWithScore.some((tag) => tag.leafTagId === 1201)).toBe(true);
  expect(result.extra.candidateSelection?.matched).toBeGreaterThan(0);
});

it("rejects oversized asset content before calling a model instead of returning NO_VALID_TAGS", async () => {
  await expect(
    predictAssetTags(
      { ...asset, description: "x".repeat(130_000) },
      {
        tagsTree: [{ id: 1, name: "标签", extra: {} }],
      },
    ),
  ).rejects.toMatchObject({ code: "TAGGING_INPUT_TOO_LARGE" });
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("does not retry or switch models after a context-window rejection", async () => {
  const { APICallError } = await import("ai");
  mocks.generate.mockImplementation(async ({ schemaName }) => {
    if (schemaName !== "TagPredictions") return { object: { terms: ["needle_target"] } };
    throw new APICallError({
      message: "prompt is too long: ContextWindowExceededError",
      statusCode: 400,
      url: "https://gateway.invalid/chat/completions",
      requestBodyValues: {},
      responseBody: '{"error":{"code":"input_too_large"}}',
    });
  });
  await expect(predictAssetTags(asset, { tagsTree: tags() })).rejects.toMatchObject({
    code: "TAGGING_INPUT_TOO_LARGE",
  });
  expect(
    mocks.generate.mock.calls.filter(([args]) => args.schemaName === "TagPredictions"),
  ).toHaveLength(1);
});
