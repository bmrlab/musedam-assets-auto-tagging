import { useProgressiveReview } from "@/app/(tagging)/tagging/review/use-progressive-review";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const windowResult = (ids: number[], next: number | null) => ({
  success: true as const,
  data: { assets: ids.map((id) => ({ id })), total: 100, totalPages: 1, nextWindowOffset: next },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("progressive review page loading", () => {
  it("bounds the first request and keeps overlapping scroll loads single-flight", async () => {
    const next = deferred<ReturnType<typeof windowResult>>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(windowResult([1, 2], 10))
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useProgressiveReview<{ id: number }>((item) => item.id));
    await act(async () => {
      await result.current.refresh(fetcher);
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, 0, 10);
    let first!: Promise<unknown>, second!: Promise<unknown>;
    act(() => {
      first = result.current.loadMore();
      second = result.current.loadMore();
    });
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve(windowResult([2, 3], null));
      await first;
    });
    expect(result.current.assets.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(result.current.hasMoreInPage).toBe(false);
  });

  it("ignores a late scroll response after changing page or filters", async () => {
    const old = deferred<ReturnType<typeof windowResult>>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(windowResult([1], 10))
      .mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => useProgressiveReview<{ id: number }>((item) => item.id));
    await act(async () => {
      await result.current.refresh(fetcher);
    });
    let loading!: Promise<unknown>;
    act(() => {
      loading = result.current.loadMore();
    });
    await act(async () => {
      await result.current.refresh(async () => windowResult([99], null));
    });
    await act(async () => {
      old.resolve(windowResult([2], null));
      await loading;
    });
    expect(result.current.assets).toEqual([{ id: 99 }]);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it("select-all can fetch the rest of a logical page, including empty filtered windows", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(windowResult([1], 10))
      .mockResolvedValueOnce(windowResult([], 20))
      .mockResolvedValueOnce(windowResult([3], null));
    const { result } = renderHook(() => useProgressiveReview<{ id: number }>((item) => item.id));
    await act(async () => {
      await result.current.refresh(fetcher);
    });
    let all;
    await act(async () => {
      all = await result.current.loadAll();
    });
    expect(all).toEqual([{ id: 1 }, { id: 3 }]);
    expect(fetcher.mock.calls).toEqual([
      [0, 10],
      [10, 100],
      [20, 100],
    ]);
  });

  it("continues past an empty first window instead of showing a false empty state", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(windowResult([], 10))
      .mockResolvedValueOnce(windowResult([11], null));
    const { result } = renderHook(() => useProgressiveReview<{ id: number }>((item) => item.id));
    await act(async () => {
      await result.current.refresh(fetcher);
    });
    expect(result.current.assets).toEqual([{ id: 11 }]);
    expect(fetcher.mock.calls).toEqual([
      [0, 10],
      [10, 10],
    ]);
  });

  it("keeps existing cards and permits retry after a failed continuation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(windowResult([1], 10))
      .mockResolvedValueOnce({ success: false, message: "network" })
      .mockResolvedValueOnce(windowResult([2], null));
    const { result } = renderHook(() => useProgressiveReview<{ id: number }>((item) => item.id));
    await act(async () => {
      await result.current.refresh(fetcher);
    });
    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow("network");
    });
    expect(result.current.assets).toEqual([{ id: 1 }]);
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.assets).toEqual([{ id: 1 }, { id: 2 }]));
  });
});
