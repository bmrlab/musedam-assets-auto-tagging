// @vitest-environment node
import { GET } from "@/app/(tagging)/api/tagging/queue-status/route";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ raw: vi.fn(), find: vi.fn(), links: vi.fn(), features: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (args: { team: { id: number } }) => unknown) => run({ team: { id: 7 } }),
}));
vi.mock("@/lib/feature-library-server", () => ({
  getFeatureLibraryFeaturesFromRequest: () => ({
    featureLibrary: state.features,
    featureBrand: false,
    featureIp: false,
    featurePerson: false,
    featureProduct: state.features,
  }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $queryRaw: state.raw,
    taggingQueueItem: { findMany: state.find },
    assetProductTag: { findMany: state.links },
  },
}));
const ids = Array.from({ length: 200 }, (_, i) => i + 1);
const row = (id: number, status = "pending") => ({
  id,
  teamId: 7,
  status,
  taskType: "manual",
  createdAt: new Date("2026-11-06"),
  assetObjectId: id,
  assetObject: null,
  result: {},
  extra: {},
});
beforeEach(() => {
  vi.resetAllMocks();
  state.features = false;
});
it("uses four database calls for 200 pending statuses instead of 1001", async () => {
  state.find.mockImplementation(async ({ where }) =>
    where.status === "completed" ? [] : ids.map((id) => row(id)),
  );
  state.raw.mockImplementation(async (sql) =>
    String(sql.text ?? sql).includes("ranked")
      ? ids.map((id) => ({ id, ahead: BigInt(id - 1) }))
      : [{ test: false, status: "pending", count: BigInt(200) }],
  );
  const response = await GET(
    new NextRequest(`http://localhost/api/tagging/queue-status?ids=${ids.join(",")}`),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.data.items).toHaveLength(200);
  expect(body.data.items[0].queueEstimate.aheadCount).toBe(0);
  expect(body.data.items[199].queueEstimate.aheadCount).toBe(199);
  expect(state.find).toHaveBeenCalledTimes(2);
  expect(state.raw).toHaveBeenCalledTimes(2);
  expect(state.links).not.toHaveBeenCalled();
  console.log("BATCH_STATUS_DATABASE_CALLS", {
    items: 200,
    before: 1001,
    after: state.find.mock.calls.length + state.raw.mock.calls.length,
  });
});
it("loads shared product links once, keeps associations and filters deleted/foreign tags", async () => {
  state.features = true;
  const product = (id: string) => ({
    assetProductId: id,
    confidence: 90,
    similarity: 0.9,
    productName: id,
    recommendedTags: [],
  });
  state.find.mockResolvedValue(
    ids.map((id) => ({
      ...row(id, "completed"),
      result: { productRecommendation: { matches: [product(id % 2 ? "a" : "b")] } },
    })),
  );
  state.links.mockResolvedValue([
    { assetProductId: "a", assetTagId: 9, tagPath: ["A"] },
    { assetProductId: "b", assetTagId: 10, tagPath: ["B"] },
  ]);
  const body = await (
    await GET(new NextRequest(`http://localhost/api/tagging/queue-status?ids=${ids.join(",")}`))
  ).json();
  expect(state.links).toHaveBeenCalledTimes(1);
  expect(state.raw).not.toHaveBeenCalled();
  expect(body.data.items[0].productLinkedTags).toEqual([
    { assetProductId: "a", assetTagId: 9, tagPath: ["A"] },
  ]);
  expect(body.data.items[1].productLinkedTags).toEqual([
    { assetProductId: "b", assetTagId: 10, tagPath: ["B"] },
  ]);
  expect(state.links).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        assetTag: { teamId: 7, deletedAt: null },
        assetProduct: { teamId: 7 },
      }),
    }),
  );
});
