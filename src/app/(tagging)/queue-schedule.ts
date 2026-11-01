import { ASSET_TAGGING_CONCURRENCY, TEST_TAGGING_CONCURRENCY } from "@/app/(tagging)/queue-config";

// 按 teamId 轮询挑选：每一轮从每个团队各取一条最早的任务，直到取满 limit 或候选池耗尽。
// items 需已按 createdAt asc 排序；返回顺序即为轮询顺序（不是严格的全局时间顺序），
// 目的是避免某个团队的任务把其他团队的任务永远挤在候选池之外/槽位之外。
export function selectRoundRobinByTeam<T extends { teamId: number }>(
  items: T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];
  const byTeam = new Map<number, T[]>();
  for (const item of items) {
    const queue = byTeam.get(item.teamId);
    if (queue) {
      queue.push(item);
    } else {
      byTeam.set(item.teamId, [item]);
    }
  }
  // Map 的插入顺序 = 各团队最早任务在全局按 createdAt 排序中的先后顺序。
  const teamIds = [...byTeam.keys()];

  const selected: T[] = [];
  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const teamId of teamIds) {
      if (selected.length >= limit) break;
      const queue = byTeam.get(teamId)!;
      const next = queue.shift();
      if (next) {
        selected.push(next);
        madeProgress = true;
      }
    }
  }
  return selected;
}

type SchedulableQueueItem = { id: number; teamId: number };

/**
 * 把本轮空闲槽位分给标签树、测试打标、正式打标。
 * 三条候选必须互斥。测试和正式分开领，避免正式积压把测试挡在候选池外面。
 * 正式队列有任务时，测试先拿 testReserved 个槽（且至少给正式留 1 个）；
 * 测试没把预留槽领满，或正式候选不够时，空槽给另一边。
 */
export function pickPendingQueueItems<T extends SchedulableQueueItem>({
  tagTreeCandidates,
  testCandidates,
  productionCandidates,
  freeSlots,
  tagTreeReserved,
  testReserved,
  assetConcurrency,
}: {
  tagTreeCandidates: T[];
  testCandidates: T[];
  productionCandidates: T[];
  freeSlots: number;
  tagTreeReserved: number;
  testReserved: number;
  assetConcurrency: number;
}): { tagTreeItems: T[]; testItems: T[]; productionItems: T[] } {
  if (freeSlots <= 0) {
    return { tagTreeItems: [], testItems: [], productionItems: [] };
  }

  const tagTreeItems = selectRoundRobinByTeam(
    tagTreeCandidates,
    Math.min(tagTreeReserved, freeSlots),
  );
  const assetSlots = Math.min(assetConcurrency, freeSlots - tagTreeItems.length);
  if (assetSlots <= 0) {
    return { tagTreeItems, testItems: [], productionItems: [] };
  }

  let testBudget = 0;
  if (testCandidates.length > 0) {
    if (productionCandidates.length === 0 || assetSlots <= 1) {
      testBudget = assetSlots;
    } else {
      testBudget = Math.min(Math.max(0, testReserved), assetSlots - 1);
    }
  }

  const testItems = selectRoundRobinByTeam(testCandidates, testBudget);
  const productionItems = selectRoundRobinByTeam(
    productionCandidates,
    assetSlots - testItems.length,
  );
  const leftover = assetSlots - testItems.length - productionItems.length;
  if (leftover > 0) {
    const picked = new Set(testItems.map((item) => item.id));
    testItems.push(
      ...selectRoundRobinByTeam(
        testCandidates.filter((item) => !picked.has(item.id)),
        leftover,
      ),
    );
  }

  return { tagTreeItems, testItems, productionItems };
}

/** 等待预估用的车道并发。另一条车道没活时，本车道可以用全部打标槽。 */
export function queueLaneConcurrency(lane: "test" | "production", otherLaneBusy: boolean): number {
  const assetSlots = Math.max(1, ASSET_TAGGING_CONCURRENCY);
  if (!otherLaneBusy) return assetSlots;
  if (assetSlots <= 1) return 1;
  const testSlots = Math.min(TEST_TAGGING_CONCURRENCY, assetSlots - 1);
  return lane === "test" ? testSlots : assetSlots - testSlots;
}
