// @vitest-environment node
import { startTaggingTasksAction } from "@/app/(tagging)/tagging/test/actions";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ team: vi.fn(), sync: vi.fn(), enqueue: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (a: { team: { id: number } }) => unknown) => run({ team: { id: 7 } }),
}));
vi.mock("@/prisma/prisma", () => ({ default: { team: { findUniqueOrThrow: state.team } } }));
vi.mock("@/musedam/assets", () => ({ syncSingleAssetFromMuseDAM: state.sync }));
vi.mock("@/app/(tagging)/queue", () => ({ enqueueTaggingTask: state.enqueue }));
vi.mock("@/lib/feature-library-server", () => ({
  getServerFeatureLibraryFeatures: async () => ({
    featureLibrary: false,
    featureBrand: false,
    featureProduct: false,
    featurePerson: false,
    featureIp: false,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("reads team once, bounds remote work at four, and preserves partial-failure ordering", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.team.mockResolvedValue({ id: 7, slug: "t/7" });
  let active = 0,
    maximum = 0;
  state.sync.mockImplementation(async ({ musedamAssetId }) => {
    maximum = Math.max(maximum, ++active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const id = Number(musedamAssetId.toString());
      if (id === 3) throw Error("sample failed");
      return { assetObject: { id, teamId: 7 } };
    } finally {
      active--;
    }
  });
  state.enqueue.mockImplementation(async ({ assetObject }) => ({ id: assetObject.id }));
  const assets = Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1),
    name: `asset${i + 1}`,
    extension: "jpg",
    size: 1,
  }));
  const pending = startTaggingTasksAction(assets);
  await vi.advanceTimersByTimeAsync(60);
  const result = await pending;
  expect(maximum).toBe(4);
  expect(state.team).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    success: true,
    data: {
      successCount: 9,
      failedCount: 1,
      queueItemIds: [1, 2, 4, 5, 6, 7, 8, 9, 10],
      failedAssets: [{ name: "asset3", reason: "sample failed" }],
    },
  });
  console.log("BATCH_START_SIMULATED", {
    assets: 10,
    serialMs: 200,
    boundedMs: 60,
    maxConcurrency: maximum,
    teamQueries: state.team.mock.calls.length,
  });
});
