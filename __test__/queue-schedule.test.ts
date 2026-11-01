import { ASSET_TAGGING_CONCURRENCY, TEST_TAGGING_CONCURRENCY } from "@/app/(tagging)/queue-config";
import { pickPendingQueueItems, queueLaneConcurrency } from "@/app/(tagging)/queue-schedule";
import { describe, expect, it } from "vitest";

type Item = { id: number; teamId: number };

function items(ids: number[], teamId = 1): Item[] {
  return ids.map((id) => ({ id, teamId }));
}

const slots = {
  freeSlots: 6,
  tagTreeReserved: 1,
  testReserved: 1,
  assetConcurrency: 5,
};

describe("pickPendingQueueItems", () => {
  it("claims a test while production tasks are queued ahead of it", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: items([101]),
      productionCandidates: items(
        Array.from({ length: 40 }, (_, index) => index + 1),
        2,
      ),
      ...slots,
    });

    expect(picked.testItems.map((item) => item.id)).toEqual([101]);
    expect(picked.productionItems).toHaveLength(4);
    expect(picked.tagTreeItems).toHaveLength(0);
  });

  it("gives every asset slot to production when no test is waiting", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: [],
      productionCandidates: items([1, 2, 3, 4, 5, 6]),
      ...slots,
    });

    expect(picked.testItems).toHaveLength(0);
    expect(picked.productionItems.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("lets tests use every asset slot when production is empty", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: items([1, 2, 3, 4, 5, 6]),
      productionCandidates: [],
      ...slots,
    });

    expect(picked.testItems.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(picked.productionItems).toHaveLength(0);
  });

  it("returns an unused test slot to production", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: items([101]),
      productionCandidates: items([1, 2, 3, 4, 5], 2),
      ...slots,
      testReserved: 2,
    });

    expect(picked.testItems.map((item) => item.id)).toEqual([101]);
    expect(picked.productionItems).toHaveLength(4);
  });

  it("fills leftover slots with tests when production runs out", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: items([101, 102, 103]),
      productionCandidates: items([1], 2),
      ...slots,
    });

    expect(picked.productionItems.map((item) => item.id)).toEqual([1]);
    expect(picked.testItems.map((item) => item.id)).toEqual([101, 102, 103]);
  });

  it("keeps the tag tree reservation and still admits a test into the remaining slots", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: items([7], 3),
      testCandidates: items([101]),
      productionCandidates: items([1, 2, 3, 4], 2),
      ...slots,
    });

    expect(picked.tagTreeItems.map((item) => item.id)).toEqual([7]);
    expect(picked.testItems.map((item) => item.id)).toEqual([101]);
    expect(picked.productionItems).toHaveLength(4);
  });

  it("gives the only free asset slot to a waiting test", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: items([101]),
      productionCandidates: items([1, 2], 2),
      freeSlots: 1,
      tagTreeReserved: 1,
      testReserved: 1,
      assetConcurrency: 5,
    });

    expect(picked.testItems.map((item) => item.id)).toEqual([101]);
    expect(picked.productionItems).toHaveLength(0);
  });

  it("round-robins tests across teams when more than one test slot is open", () => {
    const picked = pickPendingQueueItems({
      tagTreeCandidates: [],
      testCandidates: [
        { id: 1, teamId: 1 },
        { id: 2, teamId: 1 },
        { id: 3, teamId: 2 },
      ],
      productionCandidates: [],
      ...slots,
    });

    expect(picked.testItems.map((item) => item.id)).toEqual([1, 3, 2]);
  });
});

describe("queueLaneConcurrency", () => {
  it("uses every asset slot when the other lane is idle, and splits them when it is busy", () => {
    const assetSlots = Math.max(1, ASSET_TAGGING_CONCURRENCY);
    expect(queueLaneConcurrency("test", false)).toBe(assetSlots);
    expect(queueLaneConcurrency("production", false)).toBe(assetSlots);

    const testSlots = queueLaneConcurrency("test", true);
    const productionSlots = queueLaneConcurrency("production", true);
    expect(testSlots).toBeGreaterThanOrEqual(1);
    if (assetSlots > 1) {
      expect(testSlots).toBe(Math.min(TEST_TAGGING_CONCURRENCY, assetSlots - 1));
      expect(productionSlots).toBe(assetSlots - testSlots);
    }
  });
});
