import { relinkFeatureTags } from "@/lib/tagging/relink-feature-tags";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const tx = {
    assetTag: { findMany: vi.fn() },
    assetProductTag: { findMany: vi.fn(), update: vi.fn() },
    assetLogoTag: { findMany: vi.fn(), update: vi.fn() },
    assetPersonTag: { findMany: vi.fn(), update: vi.fn() },
    assetIpTag: { findMany: vi.fn(), update: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { $transaction: mocks.transaction } }));
const libraries = [
  ["assetProductTag", "assetProduct", "assetProductId"],
  ["assetLogoTag", "assetLogo", "assetLogoId"],
  ["assetPersonTag", "assetPerson", "assetPersonId"],
  ["assetIpTag", "assetIp", "assetIpId"],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((callback) => callback(mocks.tx));
  mocks.tx.assetTag.findMany.mockResolvedValue([{ id: 42, name: "标签", parentId: null }]);
  for (const [model, , featureKey] of libraries) {
    mocks.tx[model].findMany.mockResolvedValue([
      { id: model, [featureKey]: "feature", assetTagId: null, tagPath: ["标签"], sort: 1 },
    ]);
  }
});
describe("relink feature tags transaction", () => {
  it("scopes every library and target tag to the session team, with no writes in preview", async () => {
    const result = await relinkFeatureTags(7, ["product", "brand", "person", "ip"], true);
    expect(mocks.tx.assetTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 7 } }),
    );
    for (const [model, relation] of libraries) {
      expect(mocks.tx[model].findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { [relation]: { teamId: 7 } } }),
      );
      expect(mocks.tx[model].update).not.toHaveBeenCalled();
    }
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => r.matched === 1 && r.updated === 0)).toBe(true);
  });
  it("updates only the ID using one serializable transaction across all libraries", async () => {
    const result = await relinkFeatureTags(7, ["product", "brand", "person", "ip"], false);
    for (const [model] of libraries) {
      expect(mocks.tx[model].update).toHaveBeenCalledExactlyOnceWith({
        where: { id: model },
        data: { assetTagId: 42 },
      });
    }
    expect(result.results.every((r) => r.updated === 1)).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 60_000,
    });
  });
  it("propagates write failures so the database transaction rolls back", async () => {
    mocks.tx.assetProductTag.update.mockRejectedValue(new Error("write failed"));
    await expect(relinkFeatureTags(7, ["product", "brand"], false)).rejects.toThrow("write failed");
    expect(mocks.tx.assetLogoTag.update).not.toHaveBeenCalled();
  });
});
