import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 从 MuseDAM 同步标签树：两边都有的保留 id；MuseDAM 没有的本地删除；MuseDAM 有而本地没有的新增。
 * 回归：之前是 deleteMany 全表再重建，所有 id 变化，审核项 / 特征库推荐标签的外键全部被置空。
 */

type Row = {
  id: number;
  teamId: number;
  name: string;
  slug: string | null;
  parentId: number | null;
  level: number;
  sort: number;
};

const mocks = vi.hoisted(() => {
  const rows: Row[] = [];
  let nextId = 1000;
  const assetTag = {
    findMany: vi.fn(async ({ where }: { where: { teamId: number } }) =>
      rows.filter((r) => r.teamId === where.teamId),
    ),
    create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
      const row = { id: nextId++, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { teamId: number; id: { in: number[] } } }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].teamId === where.teamId && where.id.in.includes(rows[i].id)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    }),
  };
  return {
    rows,
    assetTag,
    reset: () => {
      rows.length = 0;
      nextId = 1000;
    },
    requestMuseDAMAPI: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { assetTag: mocks.assetTag } }));
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: vi.fn(async () => ({ apiKey: "k" })),
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.requestMuseDAMAPI }));

import { idToSlug } from "@/lib/slug";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { MuseDAMID } from "@/musedam/types";

const team = { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) };
const seed = (row: Omit<Row, "teamId">) => mocks.rows.push({ teamId: 1, ...row });
const mid = (n: number) => MuseDAMID.from(n);
const slugOf = (n: number) => idToSlug("assetTag", mid(n));

describe("syncTagsFromMuseDAM", () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
  });

  it("keeps ids of tags that exist on both sides, adds missing ones, deletes stale ones", async () => {
    // 本地：车型信息(10) > 品牌(11) > 小米汽车(12)；CMF属性(20) > 基础色系(21) > 蓝色系(22)
    seed({ id: 10, name: "车型信息", slug: slugOf(1), parentId: null, level: 1, sort: 5 });
    seed({ id: 11, name: "品牌", slug: slugOf(2), parentId: 10, level: 2, sort: 5 });
    seed({ id: 12, name: "小米汽车", slug: slugOf(3), parentId: 11, level: 3, sort: 5 });
    seed({ id: 20, name: "CMF属性", slug: null, parentId: null, level: 1, sort: 0 });
    seed({ id: 21, name: "基础色系", slug: null, parentId: 20, level: 2, sort: 0 });
    seed({ id: 22, name: "蓝色系", slug: null, parentId: 21, level: 3, sort: 0 });

    // MuseDAM：车型信息 > 品牌 > 小米汽车（sort 变了）；车型信息 > 车型（新增）；没有 CMF属性
    mocks.requestMuseDAMAPI.mockResolvedValue([
      {
        id: mid(1),
        name: "车型信息",
        sort: 9,
        children: [
          {
            id: mid(2),
            name: "品牌",
            sort: 5,
            children: [{ id: mid(3), name: "小米汽车", sort: 5, children: null }],
          },
          { id: mid(4), name: "车型", sort: 3, children: null },
        ],
      },
    ]);

    await syncTagsFromMuseDAM({ team });

    const byName = (name: string) => mocks.rows.find((r) => r.name === name);
    // 两边都有：id 不变
    expect(byName("车型信息")?.id).toBe(10);
    expect(byName("品牌")?.id).toBe(11);
    expect(byName("小米汽车")?.id).toBe(12);
    // sort 变化的被回填
    expect(byName("车型信息")?.sort).toBe(9);
    // MuseDAM 有、本地没有：新增，挂在原 id 的父节点下
    expect(byName("车型")).toMatchObject({ parentId: 10, level: 2, slug: slugOf(4) });
    // 本地有、MuseDAM 没有：连同子孙删除
    expect(byName("CMF属性")).toBeUndefined();
    expect(byName("基础色系")).toBeUndefined();
    expect(byName("蓝色系")).toBeUndefined();
    expect(mocks.rows).toHaveLength(4);

    expect(mocks.assetTag.create).toHaveBeenCalledTimes(1);
    expect(mocks.assetTag.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.assetTag.deleteMany.mock.calls[0][0].where.id.in.sort()).toEqual([20, 21, 22]);
  });

  it("does not touch rows that are already identical", async () => {
    seed({ id: 10, name: "车型信息", slug: slugOf(1), parentId: null, level: 1, sort: 5 });
    mocks.requestMuseDAMAPI.mockResolvedValue([
      { id: mid(1), name: "车型信息", sort: 5, children: null },
    ]);

    await syncTagsFromMuseDAM({ team });

    expect(mocks.assetTag.create).not.toHaveBeenCalled();
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
    expect(mocks.rows[0].id).toBe(10);
  });

  it("backfills a missing slug on an existing tag without changing its id", async () => {
    seed({ id: 10, name: "车型信息", slug: null, parentId: null, level: 1, sort: 5 });
    mocks.requestMuseDAMAPI.mockResolvedValue([
      { id: mid(1), name: "车型信息", sort: 5, children: null },
    ]);

    await syncTagsFromMuseDAM({ team });

    expect(mocks.rows[0]).toMatchObject({ id: 10, slug: slugOf(1) });
    expect(mocks.assetTag.create).not.toHaveBeenCalled();
  });
});
