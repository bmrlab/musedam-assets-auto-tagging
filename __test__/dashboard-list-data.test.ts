import { describe, expect, it } from "vitest";
import {
  applyThumbnailUpdates,
  type DashboardTaskListItem,
} from "@/app/(tagging)/tagging/dashboard/dashboard-list-data";

function sampleTask(overrides: {
  id?: number;
  slug?: string;
  name?: string;
  thumbnailAccessUrl?: string;
} = {}): DashboardTaskListItem {
  return {
    id: overrides.id ?? 1,
    status: "completed",
    startsAt: new Date("2026-11-10T00:00:00.000Z"),
    endsAt: new Date("2026-11-10T00:00:10.000Z"),
    result: {},
    assetObject: {
      id: overrides.id ?? 10,
      name: overrides.name ?? "asset.png",
      slug: overrides.slug ?? "asset-slug",
      extra: {
        thumbnailAccessUrl: overrides.thumbnailAccessUrl ?? "https://old.example/thumb",
        extension: "png",
        size: 1024,
      },
    },
  };
}

describe("dashboard list data", () => {
  it("merges thumbnail URL updates by asset slug", () => {
    const tasks = [
      sampleTask(),
      sampleTask({ id: 2, slug: "other-slug", name: "other.png" }),
    ];
    const updated = applyThumbnailUpdates(
      tasks,
      new Map([["asset-slug", "https://new.example/thumb"]]),
    );

    expect(updated[0].assetObject.extra.thumbnailAccessUrl).toBe("https://new.example/thumb");
    expect(updated[1].assetObject.extra.thumbnailAccessUrl).toBe("https://old.example/thumb");
    expect(updated[0]).not.toBe(tasks[0]);
  });

  it("returns the same array reference when there are no updates", () => {
    const tasks = [sampleTask()];
    expect(applyThumbnailUpdates(tasks, new Map())).toBe(tasks);
  });
});
