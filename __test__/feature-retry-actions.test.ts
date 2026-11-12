// @vitest-environment node
import { retryFeatures } from "@/app/(tagging)/tagging/review/feature-retry-actions";
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
it("enqueues a free feature-only continuation using team authorization and original mode", async () => {
  const response = await retryFeatures(1);
  expect(response.success).toBe(true);
  expect(m.source).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, teamId: 7 } }));
  expect(m.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      teamId: 7,
      assetObjectId: 2,
      extra: expect.objectContaining({
        featureRetrySourceQueueItemId: 1,
        featureImageMode: false,
        creditCost: 0,
        featurePerson: false,
      }),
    }),
  });
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
