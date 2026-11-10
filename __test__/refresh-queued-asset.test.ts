// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshQueuedAsset } from "@/lib/tagging/refresh-asset";
import { MuseDAMID } from "@/musedam/types";
import { idToSlug } from "@/lib/slug";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), team: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/assets", () => ({ syncSingleAssetFromMuseDAM: mocks.sync }));
vi.mock("@/prisma/prisma", () => ({ default: { team: { findUniqueOrThrow: mocks.team } } }));
const cached = { id: 12, teamId: 1, slug: idToSlug("assetObject", new MuseDAMID("123")), name: "Old name", materializedPath: "Old folder", extra: { ocrContent: null }, description: "", tags: [], content: {}, createdAt: new Date(0), updatedAt: new Date(0) } as Parameters<typeof refreshQueuedAsset>[1];
beforeEach(() => { vi.resetAllMocks();mocks.team.mockResolvedValue({ id: 1, slug: "t/135" }); });
describe("queue refreshes MuseDAM before recognition", () => {
  it("returns the open API's fresh OCR, URLs and path instead of the queued snapshot", async () => {
    const fresh = { ...cached, name: "New name", materializedPath: "雪花秀", extra: { ocrContent: "Sulwhasoo", downloadUrl: "fresh-url" } };
    mocks.sync.mockResolvedValue({ assetObject: fresh });
    expect(await refreshQueuedAsset(1, cached)).toBe(fresh);
    expect(mocks.sync).toHaveBeenCalledWith({ team: { id: 1, slug: "t/135" }, musedamAssetId: new MuseDAMID("123") });
    expect(cached.extra).toEqual({ ocrContent: null });
  });
  it("keeps explicit local uploads working without a nonexistent MuseDAM ID", async () => {
    const local = { ...cached, slug: "local-test-uuid", extra: { localTest: true } };
    expect(await refreshQueuedAsset(1, local)).toBe(local);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("does not silently recognize stale data when the open API fails", async () => {
    mocks.sync.mockRejectedValue(new Error("API unavailable"));
    await expect(refreshQueuedAsset(1, cached)).rejects.toThrow("API unavailable");
  });
  it("rejects cross-team rows before calling the open API", async () => {
    await expect(refreshQueuedAsset(2, cached)).rejects.toThrow("another team");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
