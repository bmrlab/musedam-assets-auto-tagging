// @vitest-environment node
import {
  applyContentOnlyRejection,
  collectTagsMissingEvidencePolicy,
} from "@/app/(tagging)/evidence-policy";
import { applyTagConfigImportChunk } from "@/lib/tagging/import-tag-config";
import type { Prisma, TagWithChildren } from "@/prisma/client";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: {} }));

it("merges imported fields into the latest locked extra rather than the preflight snapshot", async () => {
  const current = {
    evidencePolicy: "literal",
    evidencePolicySource: "auto",
    siblingsExclusive: true,
    keywords: ["AI untouched"],
    negativeKeywords: ["removed"],
    keywordRejectionCounts: { removed: 3, other: 4 },
  };
  const update = vi.fn(async ({ data }) => data);
  const execute = vi.fn(async () => 1);
  const tx = {
    $queryRaw: vi.fn(async (query: unknown) => {
      expect(query).toBeDefined();
      return [{ id: 1, extra: current }];
    }),
    $executeRaw: execute,
    assetTag: { update },
  };
  const items = [
    {
      tag: { id: 1 },
      importAncestorIds: [2],
      record: { fields: { description: "Imported", negativeKeywords: [] } },
      data: { extra: { description: "stale", keywords: ["stale"] } },
    },
  ];
  await applyTagConfigImportChunk(tx as unknown as Prisma.TransactionClient, 7, items);
  expect(update).toHaveBeenCalledWith({
    where: { id: 1, teamId: 7 },
    data: {
      extra: {
        ...current,
        description: "Imported",
        negativeKeywords: [],
        keywordRejectionCounts: { other: 4 },
        configurationSource: "import",
      },
    },
  });
  expect(execute).toHaveBeenCalledTimes(2); // ancestor marker + version bump, same transaction
  const lockSql = tx.$queryRaw.mock.calls[1][0] as unknown as { values: unknown[] };
  expect(lockSql.values).toEqual([7, 1, 2]);
});

it("does not initialize or automatically downgrade imported strategies", () => {
  const extra = {
    configurationSource: "import" as const,
    evidencePolicy: "content" as const,
    contentOnlyRejectionCount: 99,
  };
  const tree = [
    {
      id: 1,
      name: "Import",
      extra,
      children: [{ id: 2, name: "Leaf", extra: { configurationSource: "import" }, children: [] }],
    },
  ] as TagWithChildren[];
  expect(collectTagsMissingEvidencePolicy(tree)).toEqual([]);
  expect(applyContentOnlyRejection(extra)).toEqual({ extra, downgraded: false });
});

it("manual edits preserve imported provenance without marking ordinary tags as imported", async () => {
  const update = vi.fn(async ({ data }) => data);
  const tx = {
    $queryRaw: vi.fn(async () => [
      { id: 1, extra: { configurationSource: "import", evidencePolicy: "literal" } },
    ]),
    $executeRaw: vi.fn(async () => 1),
    assetTag: { update },
  };
  await applyTagConfigImportChunk(
    tx as unknown as Prisma.TransactionClient,
    7,
    [{ tag: { id: 1 }, record: { fields: { description: "Manual edit" } }, data: {} }],
    false,
  );
  expect(update.mock.calls[0][0].data.extra).toEqual({
    configurationSource: "import",
    evidencePolicy: "literal",
    description: "Manual edit",
  });
  tx.$queryRaw.mockResolvedValue([{ id: 1, extra: {} }] as never);
  await applyTagConfigImportChunk(
    tx as unknown as Prisma.TransactionClient,
    7,
    [{ tag: { id: 1 }, record: { fields: { keywords: ["Manual"] } }, data: {} }],
    false,
  );
  expect(update.mock.calls[1][0].data.extra).toEqual({ keywords: ["Manual"] });
});
