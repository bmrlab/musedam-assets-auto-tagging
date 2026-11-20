// @vitest-environment node
import { saveTagSortInTransaction } from "@/app/tags/tagSortPersistence";
import type { Prisma } from "@/prisma/client";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

it("saves 20000 siblings in one parameterized, team-scoped database round trip", async () => {
  const sorts = Array.from({ length: 20000 }, (_, i) => ({ id: i + 1, sort: 20000 - i }));
  const execute = vi.fn(async () => sorts.length);
  await saveTagSortInTransaction({ $executeRaw: execute } as unknown as Prisma.TransactionClient, 7, sorts);
  expect(execute).toHaveBeenCalledOnce();
  const [strings, ids, values, teamId] = execute.mock.calls[0] as unknown as [TemplateStringsArray, number[], number[], number];
  expect(strings.join("?")).toContain('tag."teamId" = ? AND tag."deletedAt" IS NULL');
  expect(ids).toEqual(sorts.map(item => item.id));
  expect(values).toEqual(sorts.map(item => item.sort));
  expect(teamId).toBe(7);
});

it("fails the surrounding transaction when a tag disappears before saving", async () => {
  const execute = vi.fn(async () => 1);
  await expect(saveTagSortInTransaction({ $executeRaw: execute } as unknown as Prisma.TransactionClient, 7,
    [{ id: 1, sort: 2 }, { id: 2, sort: 1 }])).rejects.toThrow("标签已变化");
});
