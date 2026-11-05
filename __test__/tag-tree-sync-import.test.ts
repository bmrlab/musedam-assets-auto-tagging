// @vitest-environment node
import {
  buildTagTreeImportRequest,
  importTagTreeSynchronously,
} from "@/musedam/tags/importTagTree";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const configs = new Map<string, { value: unknown }>();
  const rows: Array<{
    id: number;
    teamId: number;
    parentId: number | null;
    name: string;
    extra: Record<string, unknown>;
    slug?: string;
    sort?: number;
  }> = [];
  const state = { failLocal: false, id: 100 };
  const configKey = (where: { teamId_key: { teamId: number; key: string } }) =>
    JSON.stringify(where.teamId_key);
  const teamConfig = {
    findUnique: vi.fn(async ({ where }) => structuredClone(configs.get(configKey(where)) ?? null)),
    upsert: vi.fn(async ({ where, create, update }) => {
      const key = configKey(where);
      const value = { value: structuredClone((configs.has(key) ? update : create).value) };
      configs.set(key, value);
      return value;
    }),
    update: vi.fn(async ({ where, data }) => {
      const value = { value: structuredClone(data.value) };
      configs.set(configKey(where), value);
      return value;
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const key = configKey({ teamId_key: { teamId: where.teamId, key: where.key } });
      const previous = configs.get(key)?.value as { requestId: string } | undefined;
      if (previous?.requestId !== where.value.equals) return { count: 0 };
      configs.set(key, { value: structuredClone(data.value) });
      return { count: 1 };
    }),
  };
  const assetTag = {
    deleteMany: vi.fn(async ({ where }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].teamId === where.teamId && !where.id?.notIn.includes(rows[i].id)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
    findMany: vi.fn(async ({ where }) =>
      rows.filter((row) => row.teamId === where.teamId).map((row) => structuredClone(row)),
    ),
    createManyAndReturn: vi.fn(async ({ data }) => {
      if (state.failLocal) {
        state.failLocal = false;
        throw new Error("local database unavailable");
      }
      const created = data.map((row: Record<string, unknown>) => ({
        id: ++state.id,
        extra: {},
        ...structuredClone(row),
      }));
      rows.push(...created);
      return created;
    }),
  };
  const execute = vi.fn(async (strings, ...values) => {
    if (String(strings).includes("jsonb_to_recordset")) {
      const [imported, payload, teamId] = values;
      for (const patch of JSON.parse(payload)) {
        const row = rows.find((row) => row.id === patch.id && row.teamId === teamId)!;
        Object.assign(row, patch);
        if (imported) row.extra.configurationSource = "import";
      }
    }
    return 1;
  });
  const tx = { teamConfig, assetTag, $queryRaw: vi.fn(async () => []), $executeRaw: execute };
  const transaction = vi.fn(async (fn) => {
    const oldRows = structuredClone(rows),
      oldConfigs = structuredClone(configs);
    try {
      return await fn(tx);
    } catch (error) {
      rows.splice(0, rows.length, ...oldRows);
      configs.clear();
      for (const [key, value] of oldConfigs) configs.set(key, value);
      throw error;
    }
  });
  return { configs, rows, state, tx, transaction, request: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: { $transaction: mocks.transaction, teamConfig: mocks.tx.teamConfig },
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/musedam/apiKey", () => ({ retrieveTeamCredentials: async () => ({ apiKey: "test" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configs.clear();
  mocks.rows.length = 0;
  mocks.state.failLocal = false;
  mocks.request.mockImplementation(async (_path, { body }) => {
    let next = BigInt("9007199254740993");
    const nodes: unknown[] = [];
    const walk = (
      items: Array<{ clientId: string; name: string; children: typeof items }>,
      parentId = "0",
    ) => {
      for (const node of items) {
        const id = String(next++);
        nodes.push({
          clientId: node.clientId,
          id,
          parentId,
          name: node.name,
          sort: 0,
          created: true,
        });
        walk(node.children, id);
      }
    };
    walk(body.tags);
    return {
      requestId: body.requestId,
      mode: body.mode,
      createdCount: nodes.length,
      reusedCount: 0,
      nodes,
    };
  });
});
const team = { id: 7, slug: "t/123" };
const tree = [{ name: "Parent", nameChildList: [{ name: "Child" }] }];

it("preserves existing local IDs and manual extra while storing large remote IDs losslessly", async () => {
  mocks.rows.push({
    id: 15,
    teamId: 7,
    parentId: null,
    name: "Parent",
    extra: { keywords: ["manual"] },
  });
  await importTagTreeSynchronously(team, tree, true);
  expect(mocks.rows.find((row) => row.name === "Parent")).toMatchObject({
    id: 15,
    slug: "g/9007199254740993",
    extra: { keywords: ["manual"], configurationSource: "import" },
  });
  expect(mocks.rows.find((row) => row.name === "Child")).toMatchObject({
    parentId: 15,
    extra: { configurationSource: "import" },
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("retains a committed remote result after local failure and retries local save without another remote request", async () => {
  mocks.state.failLocal = true;
  await expect(importTagTreeSynchronously(team, tree, true)).rejects.toThrow(
    "local database unavailable",
  );
  expect(mocks.rows).toHaveLength(0);
  expect([...mocks.configs.values()][0].value).toMatchObject({ state: "remoteCommitted" });
  await importTagTreeSynchronously(team, tree, true);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.rows).toHaveLength(2);
  expect([...mocks.configs.values()][0].value).toMatchObject({ state: "localSaved" });
});
it("reuses the original request ID after a timeout with an unknown remote outcome", async () => {
  mocks.request.mockRejectedValueOnce(new Error("timeout"));
  await expect(importTagTreeSynchronously(team, tree)).rejects.toThrow("timeout");
  const requestId = mocks.request.mock.calls[0][1].body.requestId;
  await importTagTreeSynchronously(team, tree);
  expect(mocks.request.mock.calls[1][1].body.requestId).toBe(requestId);
});
it("rejects an incomplete response before saving any local labels", async () => {
  mocks.request.mockImplementationOnce(async (_path, { body }) => ({
    requestId: body.requestId,
    createdCount: 0,
    reusedCount: 0,
    nodes: [],
  }));
  await expect(importTagTreeSynchronously(team, tree)).rejects.toThrow("Incomplete");
  expect(mocks.rows).toHaveLength(0);
});
it("bounds local insert batches to 500 and accepts a 12000-node request", async () => {
  const large = [
    {
      name: "Parent",
      nameChildList: Array.from({ length: 1200 }, (_, i) => ({ name: `Child ${i}` })),
    },
  ];
  await importTagTreeSynchronously(team, large);
  expect(
    mocks.tx.assetTag.createManyAndReturn.mock.calls.every(([args]) => args.data.length <= 500),
  ).toBe(true);
  expect(mocks.rows).toHaveLength(1201);
  expect(
    buildTagTreeImportRequest(Array.from({ length: 12000 }, (_, i) => ({ name: `Tag ${i}` }))),
  ).toHaveLength(12000);
  expect(() =>
    buildTagTreeImportRequest(Array.from({ length: 20001 }, () => ({ name: "Tag" }))),
  ).toThrow("20000");
});

it("overwrite sends one atomic request and never deletes local rows on remote failure", async () => {
  mocks.rows.push({ id: 15, teamId: 7, parentId: null, name: "Old", extra: {} });
  mocks.request.mockRejectedValueOnce(new Error("remote create rolled back"));
  await expect(importTagTreeSynchronously(team, tree, true, "overwrite")).rejects.toThrow(
    "remote create rolled back",
  );
  expect(mocks.request.mock.calls[0][1].body.mode).toBe("overwrite");
  expect(mocks.tx.assetTag.deleteMany).not.toHaveBeenCalled();
  expect(mocks.rows.map((row) => row.name)).toEqual(["Old"]);
});
it("overwrite keeps the local old tree if local creation fails, then recovers without another remote request", async () => {
  mocks.rows.push({
    id: 15,
    teamId: 7,
    parentId: null,
    name: "Old",
    extra: { keywords: ["keep on failure"] },
  });
  mocks.state.failLocal = true;
  await expect(importTagTreeSynchronously(team, tree, true, "overwrite")).rejects.toThrow(
    "local database unavailable",
  );
  expect(mocks.rows.map((row) => row.name)).toEqual(["Old"]);
  await importTagTreeSynchronously(team, tree, true, "overwrite");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.rows.map((row) => row.name)).toEqual(["Parent", "Child"]);
});

it("does not replace local rows when an older server silently executes merge instead of overwrite", async () => {
  mocks.rows.push({ id: 15, teamId: 7, parentId: null, name: "Old", extra: {} });
  const actual = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementationOnce(async (...args) => {
    const response = await actual(...args);
    delete response.mode;
    return response;
  });
  await expect(importTagTreeSynchronously(team, tree, true, "overwrite")).rejects.toThrow(
    "主仓未确认原子覆盖模式",
  );
  expect(mocks.tx.assetTag.deleteMany).not.toHaveBeenCalled();
  expect(mocks.rows.map((row) => row.name)).toEqual(["Old"]);
});


it.each(["merge", "overwrite"] as const)("%s reuses local IDs and configuration; only overwrite removes omitted tags", async (mode) => {
  mocks.rows.push(
    { id: 15, teamId: 7, parentId: null, name: "Parent", extra: { keywords: ["keep"] } },
    { id: 16, teamId: 7, parentId: 15, name: "Child", extra: { description: "keep" } },
    { id: 17, teamId: 7, parentId: 15, name: "Omitted", extra: {} },
  );
  await importTagTreeSynchronously(team, tree, true, mode);
  expect(mocks.rows.find((row) => row.name === "Parent")).toMatchObject({ id: 15, extra: { keywords: ["keep"] } });
  expect(mocks.rows.find((row) => row.name === "Child")).toMatchObject({ id: 16, parentId: 15, extra: { description: "keep" } });
  expect(mocks.rows.some((row) => row.id === 17)).toBe(mode === "merge");
  expect(mocks.tx.assetTag.createManyAndReturn).not.toHaveBeenCalled();
});
