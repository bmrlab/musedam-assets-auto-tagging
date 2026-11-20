// @vitest-environment node
import { ensureTagMutationRecovered, withTagMutation } from "@/app/tags/tagMutation";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const markers = new Map<number, unknown>();
  return {
    markers,
    recover: vi.fn(),
    lock: vi.fn(async (_t: number, _u: number, run: () => unknown) => run()),
    upsert: vi.fn(async ({ create }: { create: { teamId: number; value: unknown } }) =>
      markers.set(create.teamId, create.value),
    ),
    remove: vi.fn(async ({ where }: { where: { teamId: number } }) => {
      markers.delete(where.teamId);
      return { count: 1 };
    }),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/app/tags/tagManagementAuth", () => ({
  withTagManagementAuth: (run: (ctx: unknown) => unknown) =>
    run({ team: { id: 1, slug: "t/11" }, user: { id: 2 } }),
}));
vi.mock("@/lib/tagging/tag-import-lock", () => ({
  runTagImportExclusive: mocks.lock,
  assertTagImportOwnership: vi.fn(),
}));
vi.mock("@/musedam/tags/syncFromMuseDAM", () => ({ syncTagsFromMuseDAM: mocks.recover }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({ teamConfig: { upsert: mocks.upsert, deleteMany: mocks.remove } }),
    teamConfig: {
      findUnique: async ({ where }: { where: { teamId_key: { teamId: number } } }) =>
        mocks.markers.get(where.teamId_key.teamId) ?? null,
      upsert: mocks.upsert,
      deleteMany: mocks.remove,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markers.clear();
  mocks.recover.mockReset().mockResolvedValue(undefined);
});

it("records intent before writes and clears it only after both stores succeed", async () => {
  const result = await withTagMutation(async () => {
    expect(mocks.markers.has(1)).toBe(true);
    return { success: true, data: undefined };
  });
  expect(result.success).toBe(true);
  expect(mocks.markers.size).toBe(0);
  expect(mocks.recover).not.toHaveBeenCalled();
});

it("reconciles remote success followed by local failure without reporting success", async () => {
  const result = await withTagMutation(async () => {
    throw new Error("local commit failed");
  });
  expect(result).toMatchObject({ success: false, message: "local commit failed" });
  expect(mocks.recover).toHaveBeenCalledExactlyOnceWith({ team: { id: 1, slug: "t/11" } });
  expect(mocks.markers.size).toBe(0);
});

it("reconciles an unknown upstream outcome and still returns the original failure", async () => {
  expect(await withTagMutation(async () => ({ success: false, message: "timeout" }))).toMatchObject(
    {
      success: false,
      message: "timeout",
    },
  );
  expect(mocks.recover).toHaveBeenCalledOnce();
});

it("retains durable intent when recovery fails and repairs it before a later read", async () => {
  mocks.recover.mockRejectedValue(new Error("offline"));
  expect(await withTagMutation(async () => ({ success: false, message: "timeout" }))).toMatchObject(
    { success: false },
  );
  expect(mocks.markers.has(1)).toBe(true);
  await expect(ensureTagMutationRecovered({ id: 1, slug: "t/11" }, 2)).rejects.toThrow("offline");
  expect(mocks.markers.has(1)).toBe(true);
  mocks.recover.mockResolvedValue(undefined);
  await ensureTagMutationRecovered({ id: 1, slug: "t/11" }, 2);
  expect(mocks.markers.size).toBe(0);
});

it("restores interrupted work before accepting another edit", async () => {
  mocks.markers.set(1, { pending: true });
  const write = vi.fn(async () => {
    expect(mocks.recover).toHaveBeenCalledOnce();
    return { success: true as const, data: undefined };
  });
  expect(await withTagMutation(write)).toMatchObject({ success: true });
  expect(write).toHaveBeenCalledOnce();
});

it("does not let nested actions clear the outer intent early", async () => {
  expect(
    await withTagMutation(async () => {
      await withTagMutation(async () => ({ success: true, data: undefined }));
      expect(mocks.markers.has(1)).toBe(true);
      expect(mocks.remove).not.toHaveBeenCalled();
      return { success: true, data: undefined };
    }),
  ).toMatchObject({ success: true });
  expect(mocks.upsert).toHaveBeenCalledOnce();
});


it("retains the intent if ownership is lost before clearing a successful operation", async () => {
  const { assertTagImportOwnership } = await import("@/lib/tagging/tag-import-lock");
  vi.mocked(assertTagImportOwnership).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("lease lost"));
  expect(await withTagMutation(async () => ({ success: true, data: undefined }))).toMatchObject({ success: false });
  expect(mocks.markers.has(1)).toBe(true);
  expect(mocks.remove).not.toHaveBeenCalled();
});
