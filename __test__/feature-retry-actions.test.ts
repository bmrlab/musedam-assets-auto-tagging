// @vitest-environment node
import { getFeatureRetryStatus, retryFeatures } from "@/app/(tagging)/tagging/review/feature-retry-actions";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  source: vi.fn(),
  active: vi.fn(),
  create: vi.fn(),
  link: vi.fn(),
  kick: vi.fn(),
  enabled: vi.fn(),
  count: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (ctx: unknown) => unknown) => run({ team: { id: 7 } }),
}));
vi.mock("@/app/(tagging)/queue", () => ({ kickQueueProcessing: m.kick }));
vi.mock("@/lib/feature-library-server", () => ({ getServerFeatureLibraryFeatures: m.enabled }));
vi.mock("@/lib/tagging/team-suspension", () => ({ assertTeamTaggingEnabled: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    taggingQueueItem: { findFirstOrThrow: m.source, findFirst: m.active },
    $transaction: (run: (tx: unknown) => unknown) =>
      run({
        $queryRaw: m.lock,
        taggingQueueItem: { findFirstOrThrow: m.source, findFirst: m.active, create: m.create, updateMany: m.link },
        logoVector: { count: m.count },
        productVector: { count: m.count },
        ipVector: { count: m.count },
      }),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.enabled.mockResolvedValue({
    featureLibrary: true,
    featureBrand: true,
    featureProduct: true,
    featureIp: true,
  });
  m.source.mockResolvedValue({
    id: 1,
    status: "completed",
    teamId: 7,
    assetObjectId: 2,
    assetObject: { id: 2 },
    extra: { featureClassify: true, featureBrand: true, featureImageMode: false },
    result: { featureDecision: { mode: "llm", decision: { status: "failed" } } },
  });
  m.link.mockResolvedValue({ count: 1 });
  m.count.mockResolvedValue(1);
  m.create.mockResolvedValue({ id: 3, status: "pending" });
});
it("requeues the original task for free while retaining evidence and the original mode", async () => {
  const response = await retryFeatures(1);
  expect(response.success).toBe(true);
  expect(m.source).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, teamId: 7 } }));
  expect(response).toEqual({ success: true, data: { id: 1, status: "pending" } });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.link).toHaveBeenCalledWith({
    where: expect.objectContaining({ id: 1, teamId: 7, status: "completed" }),
    data: expect.objectContaining({
      status: "pending",
      startsAt: null,
      endsAt: null,
      extra: expect.objectContaining({
        featureRetryInPlace: true,
        featureRetryJobId: 1,
        featureRetrySourceQueueItemId: 1,
        featureImageMode: false,
        creditCost: 0,
        featurePerson: false,
      }),
    }),
  });
  expect(m.link.mock.calls[0][0].data).not.toHaveProperty("result");
  expect(m.kick).toHaveBeenCalledOnce();
});
it("reuses an active retry rather than enqueuing a duplicate", async () => {
  m.active.mockResolvedValue({ id: 8, status: "processing" });
  expect(await retryFeatures(1)).toEqual({ success: true, data: { id: 8, status: "processing" } });
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects empty libraries before creating work", async () => {
  m.count.mockResolvedValue(0);
  await expect(retryFeatures(1)).rejects.toThrow("FEATURE_LIBRARY_EMPTY");
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects disabled feature libraries", async () => {
  m.enabled.mockResolvedValue({ featureLibrary: false });
  expect((await retryFeatures(1)).success).toBe(false);
  expect(m.source).not.toHaveBeenCalled();
});

it.each(["pending", "processing"])("returns the original %s retry without updating or creating a task", async status => {
  const source = await m.source();
  source.status = status;
  source.extra.featureRetryInPlace = true;
  expect(await retryFeatures(1)).toEqual({ success: true, data: { id: 1, status } });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.link).not.toHaveBeenCalled();
});
it("requeues a failed in-place feature retry using the same task", async () => {
  const source = await m.source();
  source.status = "failed";
  source.extra.featureRetryInPlace = true;
  expect(await retryFeatures(1)).toEqual({ success: true, data: { id: 1, status: "pending" } });
  expect(m.create).not.toHaveBeenCalled();
});
it.each(["pending", "processing", "failed", "completed"])("polls the original in-place task in %s state", async status => {
  const source = await m.source();
  source.status = status;
  source.extra.featureRetryInPlace = true;
  expect(await getFeatureRetryStatus(1)).toEqual({ success: true, data: { id: 1, status } });
  expect(m.active).not.toHaveBeenCalled();
});
it("rejects concurrent source changes without creating a task", async () => {
  m.link.mockResolvedValue({ count: 0 });
  await expect(retryFeatures(1)).rejects.toThrow("FEATURE_REVIEW_CHANGED");
  expect(m.create).not.toHaveBeenCalled();
});
