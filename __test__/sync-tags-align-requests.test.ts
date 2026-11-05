import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/musedam/apiKey", () => ({ retrieveTeamCredentials: async () => ({ apiKey: "key" }) }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetTag: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  },
}));

import { syncTagsToMuseDAMWithCurrentSystemAsBase } from "@/musedam/tags/syncToMuseDAM";

function setup(childSort: number) {
  const child = {
    id: 2,
    teamId: 1,
    slug: "g/20",
    name: "Logo",
    parentId: 1,
    sort: childSort,
    children: [],
  };
  const root = {
    id: 1,
    teamId: 1,
    slug: "g/10",
    name: "品牌",
    parentId: null,
    sort: 8,
    children: [child],
  };
  const remote = [
    { id: 10, name: "品牌", sort: 8, children: [{ id: 20, name: "Logo", sort: 7, children: [] }] },
  ];
  mocks.findMany.mockResolvedValueOnce([root]).mockResolvedValue([root, child]);
  mocks.findFirst.mockImplementation(async ({ where }) =>
    [root, child].find((tag) => tag.name === where.name && tag.parentId === where.parentId),
  );
  mocks.request.mockImplementation(async (path, options) =>
    path === "/api/muse/query-tag-tree" ? remote : { tags: options.body.tags },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});

it("does not push updates or creates when local and remote tag trees already agree", async () => {
  setup(7);
  await syncTagsToMuseDAMWithCurrentSystemAsBase({ team: { id: 1, slug: "t/77" } });
  expect(mocks.request.mock.calls.map(([path]) => path)).toEqual([
    "/api/muse/query-tag-tree",
    "/api/muse/query-tag-tree",
  ]);
});

it("sends only a changed child as update and uses its existing parent ID", async () => {
  setup(6);
  await syncTagsToMuseDAMWithCurrentSystemAsBase({ team: { id: 1, slug: "t/77" } });
  const merges = mocks.request.mock.calls.filter(([path]) => path === "/api/muse/merge-tags");
  expect(merges).toHaveLength(1);
  expect(merges[0][1].body.tags).toEqual([
    {
      id: 10,
      name: "品牌",
      sort: 8,
      operation: 0,
      children: [{ id: 20, name: "Logo", sort: 6, operation: 1 }],
    },
  ]);
});
