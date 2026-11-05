// @vitest-environment node
import { collectTagsMissingEvidencePolicy } from "@/app/(tagging)/evidence-policy";
import {
  buildEvidencePolicyBatches,
  ensureEvidencePolicies,
  fetchTagsTreeForTagging,
} from "@/app/(tagging)/evidence-policy-server";
import type { TagWithChildren } from "@/prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  query: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  leaseUpdate: vi.fn(),
  leaseDelete: vi.fn(),
  fetchTree: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: () => ({}) }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: mocks.generate,
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $queryRaw: mocks.query,
    teamConfig: { updateMany: mocks.leaseUpdate, deleteMany: mocks.leaseDelete },
    assetTag: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  },
}));
vi.mock("@/app/(tagging)/utils", () => ({ fetchTagsTree: mocks.fetchTree }));

let team = 0;
let rows = new Map<number, { id: number; extra: Record<string, unknown> }>();
let active = 0;
let maximum = 0;
function setup(count: number): TagWithChildren[] {
  const tree: TagWithChildren[] = [
    {
      id: 1,
      name: "标签",
      extra: { evidencePolicy: "content", siblingsExclusive: false },
      children: Array.from({ length: count }, (_, i) => ({
        id: i + 2,
        name: `条目${i}`,
        extra: {},
      })),
    },
  ];
  rows = new Map(tree[0].children!.map((node) => [node.id, { id: node.id, extra: {} }]));
  return tree;
}
beforeEach(() => {
  team++;
  vi.clearAllMocks();
  active = 0;
  maximum = 0;
  mocks.query.mockResolvedValue([{ id: 1 }]);
  mocks.leaseUpdate.mockResolvedValue({ count: 1 });
  mocks.leaseDelete.mockResolvedValue({ count: 1 });
  mocks.findMany.mockImplementation(async ({ where }) =>
    where.id.in.map((id: number) => structuredClone(rows.get(id))).filter(Boolean),
  );
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    const row = rows.get(where.id)!;
    const matches = JSON.stringify(row.extra) === JSON.stringify(where.extra.equals);
    if (matches) row.extra = structuredClone(data.extra);
    active--;
    return { count: matches ? 1 : 0 };
  });
  mocks.generate.mockImplementation(async ({ prompt }: { prompt: string }) => ({
    object: {
      tags: [...prompt.matchAll(/^- id (\d+):/gm)].map((match) => ({
        id: Number(match[1]),
        policy: "content",
      })),
    },
  }));
});

it("classifies at most 1000 tags per call and limits database write concurrency", async () => {
  const tagsTree = setup(2200);
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree })).toEqual({ classified: 2200 });
  expect(mocks.generate).toHaveBeenCalledTimes(3);
  for (const [args] of mocks.generate.mock.calls) {
    expect([...args.prompt.matchAll(/^- id /gm)].length).toBeLessThanOrEqual(1000);
    expect(args.prompt.length).toBeLessThan(32500);
  }
  expect(maximum).toBeLessThanOrEqual(5);
  expect(collectTagsMissingEvidencePolicy(tagsTree)).toHaveLength(0);
});

it("enforces a character budget for long tag paths", () => {
  const tagsTree = setup(1000);
  tagsTree[0].name = "长父级".repeat(30);
  const batches = buildEvidencePolicyBatches(collectTagsMissingEvidencePolicy(tagsTree));
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every((batch) => batch.length <= 1000)).toBe(true);
});

it("retains completed batches and resumes only missing tags after a provider failure", async () => {
  const tree = setup(1200);
  const normal = mocks.generate.getMockImplementation()!;
  mocks.generate
    .mockImplementationOnce(normal)
    .mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree: tree })).toEqual({
    classified: 1000,
  });
  expect(collectTagsMissingEvidencePolicy(tree)).toHaveLength(200);
  const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  try {
    expect(await ensureEvidencePolicies({ teamId: team, tagsTree: tree })).toEqual({
      classified: 200,
    });
    expect(collectTagsMissingEvidencePolicy(tree)).toHaveLength(0);
  } finally {
    time.mockRestore();
  }
});

it("does not overwrite a concurrent administrator edit", async () => {
  const tagsTree = setup(1);
  mocks.updateMany.mockImplementationOnce(async () => {
    rows.get(2)!.extra = {
      evidencePolicy: "literal",
      evidencePolicySource: "feedback",
      description: "人工配置",
    };
    return { count: 0 };
  });
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree })).toEqual({ classified: 0 });
  expect(rows.get(2)!.extra.evidencePolicy).toBe("literal");
  expect(rows.get(2)!.extra.description).toBe("人工配置");
});

it("avoids duplicate initialization when another process owns the lease", async () => {
  mocks.query.mockResolvedValueOnce([]);
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree: setup(10) })).toEqual({
    classified: 0,
  });
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("loads the tree without waiting for background initialization and shares in-flight work", async () => {
  const tree = setup(1);
  mocks.fetchTree.mockResolvedValue(tree);
  let finish!: (result: unknown) => void;
  mocks.generate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(await fetchTagsTreeForTagging({ teamId: team })).toBe(tree);
  await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  const joined = ensureEvidencePolicies({ teamId: team, tagsTree: tree });
  finish({ object: { tags: [{ id: 2, policy: "literal" }] } });
  expect(await joined).toEqual({ classified: 1 });
  expect(mocks.generate).toHaveBeenCalledOnce();
});

it("splits a batch after a structured-output limit instead of retrying the oversized payload forever", async () => {
  const tree = setup(1200);
  const failure = new Error("output length limit");
  failure.name = "AI_NoObjectGeneratedError";
  mocks.generate.mockRejectedValueOnce(failure);
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree: tree })).toEqual({
    classified: 1200,
  });
  expect(mocks.generate).toHaveBeenCalledTimes(4);
  expect(collectTagsMissingEvidencePolicy(tree)).toHaveLength(0);
});

it("leaves omitted tags pending rather than permanently classifying them as literal", async () => {
  const tree = setup(2);
  mocks.generate.mockResolvedValueOnce({ object: { tags: [] } });
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree: tree })).toEqual({ classified: 0 });
  expect(collectTagsMissingEvidencePolicy(tree)).toHaveLength(2);
  expect(mocks.updateMany).not.toHaveBeenCalled();
});

it("uses the configured model fallback when the primary classifier is unavailable", async () => {
  const { APICallError } = await import("ai");
  mocks.generate.mockRejectedValueOnce(
    new APICallError({
      message: "primary unavailable",
      url: "https://example.invalid",
      requestBodyValues: {},
      statusCode: 503,
    }),
  );
  expect(await ensureEvidencePolicies({ teamId: team, tagsTree: setup(1) })).toEqual({
    classified: 1,
  });
  expect(mocks.generate).toHaveBeenCalledTimes(2);
});
