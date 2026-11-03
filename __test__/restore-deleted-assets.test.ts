import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  team: vi.fn(),
  candidates: vi.fn(),
  query: vi.fn(),
  current: vi.fn(),
  count: vi.fn(),
  updateAudits: vi.fn(),
  updateAsset: vi.fn(),
  request: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock("@/musedam/apiKey", () => ({ retrieveTeamCredentials: mocks.credentials }));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    team: { findUnique: mocks.team },
    assetObject: { findMany: mocks.candidates },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: mocks.query,
        assetObject: { findUniqueOrThrow: mocks.current, update: mocks.updateAsset },
        taggingAuditItem: { count: mocks.count, updateMany: mocks.updateAudits },
      }),
  },
}));

import { restoreDeletedAssets } from "@/lib/tagging/restore-deleted-assets";
const input = { musedamTeamId: "159945", dryRun: true, afterId: 0, limit: 1 };
describe("deleted review restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.team.mockResolvedValue({ id: 1025, slug: "t/159945" });
    mocks.candidates.mockResolvedValue([{ id: 4, slug: "a/42", name: "existing" }]);
    mocks.credentials.mockResolvedValue({ apiKey: "test" });
    mocks.request.mockResolvedValue([{ id: 42 }]);
    mocks.current.mockResolvedValue({ extra: { reviewAssetDeleted: true, other: "keep" } });
    mocks.count.mockResolvedValue(3);
    mocks.updateAudits.mockResolvedValue({ count: 3 });
  });
  it("scopes candidates to the named team and deletion marker, previews without writes", async () => {
    const result = await restoreDeletedAssets(input);
    expect(mocks.candidates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          teamId: 1025,
          id: { gt: 0 },
          extra: { path: ["reviewAssetDeleted"], equals: true },
        },
      }),
    );
    expect(result?.results[0]).toMatchObject({ outcome: "eligible", auditItems: 3 });
    expect(mocks.updateAsset).not.toHaveBeenCalled();
    expect(mocks.updateAudits).not.toHaveBeenCalled();
  });
  it("only resets rejected audits and preserves unrelated asset metadata", async () => {
    await restoreDeletedAssets({ ...input, dryRun: false });
    expect(mocks.updateAudits).toHaveBeenCalledWith({
      where: { teamId: 1025, assetObjectId: 4, status: "rejected" },
      data: { status: "pending" },
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: { id: 4, teamId: 1025 },
      data: { extra: { other: "keep" } },
    });
  });
  it("does not restore assets the upstream API cannot see", async () => {
    mocks.request.mockResolvedValue([]);
    const result = await restoreDeletedAssets({ ...input, dryRun: false });
    expect(result?.results[0].outcome).toBe("unavailable");
    expect(mocks.updateAudits).not.toHaveBeenCalled();
    expect(mocks.updateAsset).not.toHaveBeenCalled();
  });
  it("skips an asset whose marker was concurrently cleared", async () => {
    mocks.current.mockResolvedValue({ extra: {} });
    expect((await restoreDeletedAssets({ ...input, dryRun: false }))?.results[0].outcome).toBe(
      "changed",
    );
    expect(mocks.updateAudits).not.toHaveBeenCalled();
  });
  it("uses stable cursor pagination even for unavailable assets", async () => {
    mocks.candidates.mockResolvedValue([
      { id: 4, slug: "a/42" },
      { id: 8, slug: "a/99" },
    ]);
    mocks.request.mockResolvedValue([]);
    expect(await restoreDeletedAssets(input)).toMatchObject({ hasMore: true, nextAfterId: 4 });
  });
  it("does not write after an upstream error or malformed response", async () => {
    mocks.request.mockResolvedValue({});
    await expect(restoreDeletedAssets({ ...input, dryRun: false })).rejects.toThrow(
      "Invalid MuseDAM",
    );
    expect(mocks.updateAudits).not.toHaveBeenCalled();
  });
});
