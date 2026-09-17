import type { MigrationBundle } from "@/lib/migration/export-team";
import { ImportCancelledError, importTeamBundle, remapObjectKey } from "@/lib/migration/import-team";
import { describe, expect, it } from "vitest";

// 最小可用的 Prisma 替身：记录 upsert / transaction / raw 调用，count 按已写入的行数返回
function fakePrisma() {
  const written: Record<string, Map<unknown, unknown>> = {};
  const transactions: number[] = [];
  const raw: string[] = [];
  const table = (name: string) => (written[name] ??= new Map());
  const model = (name: string) => ({
    findUnique: async ({ where }: { where: { id: unknown } }) => table(name).get(where.id) ?? null,
    upsert: ({ where, create }: { where: { id: unknown }; create: unknown }) => ({
      __op: () => table(name).set(where.id, create),
    }),
    update: ({ where, data }: { where: { id: unknown }; data: Record<string, unknown> }) => ({
      __op: () => table(name).set(where.id, { ...(table(name).get(where.id) as object), ...data }),
    }),
    count: async ({ where }: { where: { teamId: number } }) =>
      [...table(name).values()].filter((r) => (r as { teamId?: number }).teamId === where.teamId).length,
  });
  const client = new Proxy(
    {
      $transaction: async (ops: { __op: () => void }[]) => {
        transactions.push(ops.length);
        for (const op of ops) op.__op();
        return ops.map(() => undefined);
      },
      $executeRawUnsafe: (sql: string, ...args: unknown[]) => ({
        __op: () => raw.push(sql.trim().split("\n")[0] + (args.length ? ` [${args.length} args]` : "")),
      }),
    } as Record<string, unknown>,
    { get: (t, k: string) => (k in t ? t[k] : model(k)) },
  );
  // 序列重置那几条 raw 不在事务里，直接执行
  const origRaw = client.$executeRawUnsafe as (sql: string, ...a: unknown[]) => { __op: () => void };
  (client as Record<string, unknown>).$executeRawUnsafe = (sql: string, ...a: unknown[]) => {
    const op = origRaw(sql, ...a);
    if (/setval/.test(sql)) {
      op.__op();
      return Promise.resolve(1);
    }
    return op;
  };
  return { client, written, transactions, raw };
}

function bundle(rows = 5): MigrationBundle {
  const teamId = 7;
  const many = (n: number, extra: (i: number) => object = () => ({})) =>
    Array.from({ length: n }, (_, i) => ({ id: `${i}`, teamId, ...extra(i) }));
  return {
    manifest: {
      version: 1,
      teamId,
      teamSlug: "t/7",
      teamName: "T",
      exportedAt: "",
      imageCount: 0,
      signedUrlExpiresAt: null,
    },
    assets: [],
    db: {
      team: [{ id: teamId, slug: "t/7", name: "T" }],
      teamConfig: [],
      assetTag: [
        { id: 1, teamId, name: "root", parentId: null },
        { id: 2, teamId, name: "child", parentId: 1 },
      ],
      assetObject: [],
      assetLogoType: [],
      assetLogo: many(rows),
      assetLogoImage: [],
      assetLogoTag: [],
      assetIpType: [],
      assetIp: [],
      assetIpImage: [],
      assetIpTag: [],
      assetProductType: [],
      assetProduct: [],
      assetProductImage: [],
      assetProductTag: [],
      assetPersonType: [],
      assetPerson: [],
      assetPersonImage: [],
      assetPersonTag: [],
      LogoVector: many(3, (i) => ({ embeddingText: `[${i}]`, createdAt: "2026-01-01T00:00:00Z" })),
      IpVector: [],
      ProductVector: [],
      PersonVector: [],
      taggingQueueItem: [],
      taggingAuditItem: [],
    },
  };
}

describe("importTeamBundle", () => {
  it("writes in batched transactions, frees bundle tables, and verifies counts", async () => {
    const { client, written, transactions, raw } = fakePrisma();
    const b = bundle(5);
    const progress: string[] = [];
    const result = await importTeamBundle(client as never, b, {
      phase: "all",
      batchSize: 2,
      onProgress: (p) => progress.push(`${p.label}:${p.done}/${p.total}`),
    });

    // 5 行 logo 按 2 行一批 -> 3 个事务
    expect(transactions.filter((n) => n <= 2).length).toBeGreaterThanOrEqual(3);
    expect(written.assetLogo.size).toBe(5);
    // AssetTag 两遍：先 parentId=null，再补
    expect((written.assetTag.get(2) as { parentId: unknown }).parentId).toBe(1);
    // 向量表走 raw SQL，且在事务里
    expect(raw.filter((s) => s.includes('INSERT INTO "LogoVector"')).length).toBe(3);
    expect(raw.some((s) => /setval/.test(s))).toBe(true);
    // 写完后表数组被清空释放
    expect(b.db.assetLogo).toHaveLength(0);
    expect(b.db.LogoVector).toHaveLength(0);
    // verify 用的是开跑前记下的行数
    expect(result.verify?.ok).toBe(true);
    expect(result.verify?.tables.find((t) => t.table === "AssetLogo")).toMatchObject({ exported: 5, target: 5 });
    expect(result.db?.tables.assetLogo).toBe(5);
    expect(progress).toContain("assetLogo:5/5");
  });

  it("dry run writes nothing but still reports counts", async () => {
    const { client, written, transactions } = fakePrisma();
    const result = await importTeamBundle(client as never, bundle(4), { phase: "db", dryRun: true });
    expect(transactions).toHaveLength(0);
    expect(written.assetLogo?.size ?? 0).toBe(0);
    expect(result.db?.tables.assetLogo).toBe(4);
  });

  it("stops at the next batch boundary when cancelled", async () => {
    const { client, transactions } = fakePrisma();
    let calls = 0;
    await expect(
      importTeamBundle(client as never, bundle(10), {
        phase: "db",
        batchSize: 2,
        shouldCancel: () => ++calls > 2,
      }),
    ).rejects.toBeInstanceOf(ImportCancelledError);
    expect(transactions.length).toBeLessThan(5);
  });

  it("refuses when the team id is taken by a different slug", async () => {
    const { client, written } = fakePrisma();
    (written.team ??= new Map()).set(7, { id: 7, slug: "t/other" });
    await expect(importTeamBundle(client as never, bundle(1), { phase: "db" })).rejects.toThrow(/slug 不一致/);
  });
});

describe("remapObjectKey", () => {
  it("rewrites only when asked", () => {
    expect(remapObjectKey("feature-library/a.jpg", "feature-library", "auto-tagging/feature-library", true)).toBe(
      "auto-tagging/feature-library/a.jpg",
    );
    expect(remapObjectKey("feature-library/a.jpg", "feature-library", "x", false)).toBe("feature-library/a.jpg");
    expect(remapObjectKey("a.jpg", "", "x", true)).toBe("x/a.jpg");
  });
});
