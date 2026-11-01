import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMuseDAMFolderSubIds = vi.fn();
vi.mock("@/musedam/assets", () => ({
  fetchMuseDAMFolderSubIds: (...args: unknown[]) => fetchMuseDAMFolderSubIds(...args),
}));

import {
  buildAllowedFolderIdSet,
  isAssetInApplicationScope,
} from "@/app/(tagging)/application-scope";
import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";

const team = { id: 1, slug: "team-1" };
const folderSlug = (id: number) => idToSlug("assetFolder", new MuseDAMID(id));

describe("buildAllowedFolderIdSet", () => {
  beforeEach(() => fetchMuseDAMFolderSubIds.mockReset());

  it("returns null (no restriction) for scopeType all without calling MuseDAM", async () => {
    const allowed = await buildAllowedFolderIdSet({
      team,
      applicationScope: { scopeType: "all", selectedFolders: [] },
    });
    expect(allowed).toBeNull();
    expect(fetchMuseDAMFolderSubIds).not.toHaveBeenCalled();
  });

  it("includes the selected folders and every sub-folder returned by MuseDAM", async () => {
    fetchMuseDAMFolderSubIds.mockResolvedValue({ "10": [11, "12"], "20": [] });
    const allowed = await buildAllowedFolderIdSet({
      team,
      applicationScope: {
        scopeType: "specific",
        selectedFolders: [
          { slug: folderSlug(10), name: "A" },
          { slug: folderSlug(20), name: "B" },
        ],
      },
    });
    expect(allowed).not.toBeNull();
    expect([...allowed!].sort()).toEqual(["10", "11", "12", "20"]);
    expect(fetchMuseDAMFolderSubIds).toHaveBeenCalledTimes(1);
    expect(fetchMuseDAMFolderSubIds.mock.calls[0][0].musedamFolderIds.map(String)).toEqual([
      "10",
      "20",
    ]);
  });

  it("does not call MuseDAM when no folder is selected", async () => {
    const allowed = await buildAllowedFolderIdSet({
      team,
      applicationScope: { scopeType: "specific", selectedFolders: [] },
    });
    expect(allowed?.size).toBe(0);
    expect(fetchMuseDAMFolderSubIds).not.toHaveBeenCalled();
  });
});

describe("isAssetInApplicationScope", () => {
  it("matches an asset in a sub-folder of a selected folder (the batch-route bug)", () => {
    const allowed = new Set(["10", "11"]);
    expect(isAssetInApplicationScope([new MuseDAMID(11)], allowed)).toBe(true);
    expect(isAssetInApplicationScope([new MuseDAMID(99)], allowed)).toBe(false);
    expect(isAssetInApplicationScope([], allowed)).toBe(false);
    expect(isAssetInApplicationScope([new MuseDAMID(99)], null)).toBe(true);
  });
});
