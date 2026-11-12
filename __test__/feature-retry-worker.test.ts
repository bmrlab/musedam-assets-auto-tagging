// @vitest-environment node
import { saveFeatureRetry } from "@/app/(tagging)/tagging/review/feature-retry-worker";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  source: vi.fn(),
  newer: vi.fn(),
  updateSource: vi.fn(),
  pending: vi.fn(),
  create: vi.fn(),
  updateJob: vi.fn(),
  owned: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tagging/queue-execution", () => ({ assertQueueExecutionOwned: m.owned }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({
        taggingQueueItem: {
          findFirstOrThrow: m.source,
          updateMany: m.updateSource,
          update: m.updateJob,
        },
        taggingAuditItem: { findFirst: m.newer, create: m.create },
      }),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.source.mockResolvedValue({
    id: 1,
    status: "completed",
    teamId: 7,
    assetObjectId: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    extra: {},
    result: {
      predictions: { basicInfo: ["kept"] },
      tagsWithScore: [{ leafTagId: 99 }],
      metadataPredictions: ["kept"],
      outputTypes: { tags: true, fields: true, features: false },
      personRecommendation: { preserved: true },
    },
  });
  m.updateSource.mockResolvedValue({ count: 1 });
  m.newer.mockResolvedValue(null);
});
it("merges only features and creates a feature review carrier without touching reviewed tags", async () => {
  await saveFeatureRetry(7, 1, 3, {
    brandRecommendation: { bestMatch: { assetLogoId: "one" } } as never,
    featureDecision: { ocr: { status: "empty", segments: [] }, decision: { status: "completed" } },
  });
  expect(m.updateSource).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        result: expect.objectContaining({
          predictions: { basicInfo: ["kept"] },
          tagsWithScore: [{ leafTagId: 99 }],
          metadataPredictions: ["kept"],
          personRecommendation: { preserved: true },
          outputTypes: { tags: true, fields: true, features: true },
        }),
      },
    }),
  );
  expect(m.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      queueItemId: 1,
      leafTagId: null,
      tagPath: [],
      status: "pending",
    }),
  });
  expect(m.updateJob).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }),
  );
});
it("rejects evidence superseded by a newer batch", async () => {
  m.newer.mockResolvedValue({ id: 9 });
  await expect(saveFeatureRetry(7, 1, 3, {})).rejects.toThrow("SUPERSEDED");
  expect(m.updateSource).not.toHaveBeenCalled();
});
it("rejects a feature scope reviewed while retry was running", async () => {
  const source = await m.source();
  source.startsAt = new Date();
  source.extra = { featureReview: { scoped: true, runStartedAt: source.startsAt.toISOString() } };
  await expect(saveFeatureRetry(7, 1, 3, {}, source.startsAt.toISOString())).rejects.toThrow(
    "ALREADY_COMPLETE",
  );
  expect(m.updateSource).not.toHaveBeenCalled();
});
it("rejects concurrent source changes rather than overwriting them", async () => {
  m.updateSource.mockResolvedValue({ count: 0 });
  await expect(saveFeatureRetry(7, 1, 3, {})).rejects.toThrow("CHANGED");
  expect(m.create).not.toHaveBeenCalled();
});

it("rejects a retry when the original queue item has been reused for a newer run", async () => {
  const source = await m.source();
  source.startsAt = new Date();
  await expect(saveFeatureRetry(7, 1, 3, {}, "2026-11-12T00:00:00.000Z")).rejects.toThrow(
    "SUPERSEDED",
  );
  expect(m.updateSource).not.toHaveBeenCalled();
});
