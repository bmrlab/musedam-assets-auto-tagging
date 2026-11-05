// @vitest-environment node
import {
  assertTagImportOwnership,
  runTagImportExclusive,
  TagImportBusyError,
  TAG_IMPORT_MAX_DURATION_MS,
  TagImportTimeoutError,
} from "@/lib/tagging/tag-import-lock";
import type { Prisma } from "@/prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  type Lease = { token: string; memberName: string; expiresAt: number; createdAt: number; deadlineAt?: number };
  const leases = new Map<number, Lease>();
  const query = vi.fn(async (strings, ...values) => {
    if (String(strings).includes('AS "memberName"')) {
      const lease = leases.get(values[0]);
      return lease && lease.expiresAt > Date.now() && (lease.deadlineAt ?? lease.createdAt + values[2]) > Date.now() ? [{ memberName: lease.memberName }] : [];
    }
    if (String(strings).includes("INSERT INTO")) {
      const [team, , token, memberName, duration, maximumDuration] = values;
      const previous = leases.get(team);
      if (previous && previous.expiresAt >= Date.now() && (previous.deadlineAt ?? previous.createdAt + maximumDuration) > Date.now()) return [];
      leases.set(team, { token, memberName, expiresAt: Date.now() + duration, createdAt: Date.now(), deadlineAt: Date.now() + maximumDuration });
      return [{ id: 1 }];
    }
    const [team, , token] = values;
    const lease = leases.get(team);
    return lease && lease.token === token && lease.expiresAt > Date.now() ? [{ id: 1 }] : [];
  });
  const execute = vi.fn(async (strings, ...values) => {
    void strings;
    const [duration, team, , token] = values;
    const lease = leases.get(team);
    if (!lease || lease.token !== token || lease.expiresAt <= Date.now()) return 0;
    lease.expiresAt = Math.min(Date.now() + duration, lease.deadlineAt!);
    return 1;
  });
  const config = {
    findUnique: vi.fn(async ({ where }) => ({ value: leases.get(where.teamId_key.teamId) })),
    deleteMany: vi.fn(async ({ where }) => {
      if (leases.get(where.teamId)?.token === where.value.equals) {
        leases.delete(where.teamId);
        return { count: 1 };
      }
      return { count: 0 };
    }),
  };
  return { leases, query, execute, config };
});
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    user: {
      findUnique: async ({ where }: { where: { id: number } }) => ({
        name: where.id === 1 ? "张三" : "李四",
      }),
    },
    $queryRaw: mocks.query,
    $executeRaw: mocks.execute,
    teamConfig: mocks.config,
  },
}));
const tx = { $queryRaw: mocks.query } as unknown as Prisma.TransactionClient;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  mocks.leases.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

it("rejects a second member immediately with the running member's name, then permits retry after release", async () => {
  const started = gate(),
    finish = gate();
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve();
    await finish.promise;
  });
  await started.promise;
  const secondRun = vi.fn();
  const busy = await runTagImportExclusive(7, 2, secondRun).catch((error) => error);
  expect(busy).toBeInstanceOf(TagImportBusyError);
  expect((busy as TagImportBusyError).memberName).toBe("张三");
  expect(secondRun).not.toHaveBeenCalled();
  finish.resolve();
  await first;
  await runTagImportExclusive(7, 2, async () => "done");
  expect(mocks.leases.has(7)).toBe(false);
});
it("does not block other teams and releases on failure", async () => {
  const started = gate(),
    finish = gate();
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve();
    await finish.promise;
  });
  await started.promise;
  await expect(runTagImportExclusive(8, 2, async () => "other team")).resolves.toBe("other team");
  finish.resolve();
  await first;
  await expect(
    runTagImportExclusive(7, 1, async () => {
      throw new Error("failed import");
    }),
  ).rejects.toThrow("failed import");
  expect(mocks.leases.has(7)).toBe(false);
});
it("renews the lease while a long import is running", async () => {
  const started = gate(),
    finish = gate();
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve();
    await finish.promise;
  });
  await started.promise;
  await vi.advanceTimersByTimeAsync(180000);
  await expect(runTagImportExclusive(7, 2, async () => {})).rejects.toBeInstanceOf(
    TagImportBusyError,
  );
  expect(mocks.execute.mock.calls.length).toBeGreaterThan(3);
  finish.resolve();
  await first;
});
it("fences a resumed old process and never releases the new owner's lease", async () => {
  const started = gate(),
    resume = gate(),
    secondStarted = gate(),
    secondFinish = gate();
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve();
    await resume.promise;
    await assertTagImportOwnership(tx);
  });
  await started.promise;
  // Simulate a suspended process: move the clock without running its heartbeat.
  vi.setSystemTime(Date.now() + 121000);
  const second = runTagImportExclusive(7, 2, async () => {
    secondStarted.resolve();
    await secondFinish.promise;
  });
  await secondStarted.promise;
  const failure = expect(first).rejects.toThrow("执行锁已失效");
  resume.resolve();
  await failure;
  expect(mocks.leases.get(7)?.memberName).toBe("李四");
  secondFinish.resolve();
  await second;
});


it("caps heartbeat renewal and fences a hung task after its overall deadline", async () => {
  const started = gate(), resume = gate(), nextStarted = gate(), nextFinish = gate();
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve();
    await resume.promise;
    await assertTagImportOwnership(tx);
  });
  const failed = expect(first).rejects.toBeInstanceOf(TagImportTimeoutError);
  await started.promise;
  const maximumExpiry = Date.now() + TAG_IMPORT_MAX_DURATION_MS;
  await vi.advanceTimersByTimeAsync(TAG_IMPORT_MAX_DURATION_MS - 1);
  expect(mocks.leases.get(7)!.expiresAt).toBeLessThanOrEqual(maximumExpiry);
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  expect(mocks.leases.has(7)).toBe(false);
  const next = runTagImportExclusive(7, 2, async () => {
    nextStarted.resolve(); await nextFinish.promise;
  });
  await nextStarted.promise;
  resume.resolve();
  await Promise.resolve();
  expect(mocks.leases.get(7)?.memberName).toBe("李四");
  nextFinish.resolve(); await next;
});

it("does not keep a completed request hanging on a stuck heartbeat cleanup", async () => {
  const started = gate(), finish = gate(), renewal = gate();
  mocks.execute.mockImplementationOnce(async () => { await renewal.promise; return 0; });
  const first = runTagImportExclusive(7, 1, async () => {
    started.resolve(); await finish.promise; return "done";
  });
  await started.promise;
  await vi.advanceTimersByTimeAsync(20_000);
  finish.resolve();
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(first).resolves.toBe("done");
  // No unsafe deletion when cleanup could not establish the heartbeat's outcome.
  expect(mocks.leases.has(7)).toBe(true);
  await vi.advanceTimersByTimeAsync(120_000);
  await expect(runTagImportExclusive(7, 2, async () => "retry")).resolves.toBe("retry");
  renewal.resolve();
});


it("automatically takes over an over-age legacy lock even if the old process kept renewing it", async () => {
  mocks.leases.set(7, {
    token: "legacy-task", memberName: "张三", expiresAt: Date.now() + 120_000,
    createdAt: Date.now() - TAG_IMPORT_MAX_DURATION_MS - 1,
  });
  await expect(runTagImportExclusive(7, 1, async () => {
    await assertTagImportOwnership(tx);
    expect(mocks.leases.get(7)?.token).not.toBe("legacy-task");
    return "recovered";
  })).resolves.toBe("recovered");
  expect(mocks.leases.has(7)).toBe(false);
});

it("keeps a recent legacy lock exclusive until its maximum age is reached", async () => {
  mocks.leases.set(7, {
    token: "legacy-task", memberName: "张三", expiresAt: Date.now() + 120_000, createdAt: Date.now(),
  });
  await expect(runTagImportExclusive(7, 2, async () => {})).rejects.toBeInstanceOf(TagImportBusyError);
  expect(mocks.leases.get(7)?.token).toBe("legacy-task");
});
