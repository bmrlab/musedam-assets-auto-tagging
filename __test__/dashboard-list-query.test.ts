// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { $queryRaw: query } }));
import { loadDashboardTaskListItems } from "@/app/(tagging)/tagging/dashboard/dashboard-list-query";

beforeEach(() => vi.resetAllMocks());

it.each([0, 1, 2, 16, null, undefined, "2", -1, 1.5])(
  "uses the recorded numeric credit cost without repricing: %s",
  async (creditCost) => {
    query.mockResolvedValue([{
      id: 1, status: "pending", startsAt: null, endsAt: null, result: {},
      creditCost, assetObjectId: 10, assetName: "video.mp4", assetSlug: "asset-slug",
      assetExtra: { extension: "mp4" },
    }]);
    const [task] = await loadDashboardTaskListItems(7, [1]);
    expect(task.creditCost).toBe(typeof creditCost === "number" && creditCost >= 0 && Number.isInteger(creditCost) ? creditCost : null);
  },
);
