"use client";

import type { ServerActionResult } from "@/lib/serverAction";
import { useCallback, useEffect, useRef, useState } from "react";

export type ReviewPageWindow<T> = {
  assets: T[];
  total: number;
  totalPages: number;
  nextWindowOffset: number | null;
};

const WINDOW_SIZE = 10;

/** Each refresh owns its requests; late responses from an older filter/page are ignored. */
export function useProgressiveReview<T>(key: (item: T) => number) {
  const [assets, setAssets] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreInPage, setHasMoreInPage] = useState(false);
  const generation = useRef(0);
  const items = useRef<T[]>([]);
  const nextOffset = useRef<number | null>(null);
  const fetchWindow = useRef<
    ((offset: number, size: number) => Promise<ServerActionResult<ReviewPageWindow<T>>>) | null
  >(null);
  const pending = useRef<Promise<T[] | undefined> | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const refresh = useCallback(async (fetcher: NonNullable<typeof fetchWindow.current>) => {
    const version = ++generation.current;
    fetchWindow.current = fetcher;
    pending.current = null;
    nextOffset.current = null;
    items.current = [];
    setAssets([]);
    setIsLoading(true);
    setIsLoadingMore(false);
    setHasMoreInPage(false);
    try {
      let result = await fetcher(0, WINDOW_SIZE);
      while (
        version === generation.current &&
        result.success &&
        !result.data.assets.length &&
        result.data.nextWindowOffset !== null
      ) {
        result = await fetcher(result.data.nextWindowOffset, WINDOW_SIZE);
      }
      if (version !== generation.current) return;
      if (!result.success) throw new Error(result.message);
      items.current = result.data.assets;
      nextOffset.current = result.data.nextWindowOffset;
      setAssets(items.current);
      setTotal(result.data.total);
      setTotalPages(result.data.totalPages);
      setHasMoreInPage(nextOffset.current !== null);
      return items.current;
    } finally {
      if (version === generation.current) setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback((size = WINDOW_SIZE): Promise<T[] | undefined> => {
    if (pending.current) return pending.current;
    if (nextOffset.current === null || !fetchWindow.current) return Promise.resolve(items.current);
    const version = generation.current;
    const offset = nextOffset.current;
    const fetcher = fetchWindow.current;
    setIsLoadingMore(true);
    const request = (async () => {
      try {
        const result = await fetcher(offset, size);
        if (version !== generation.current) return;
        if (!result.success) throw new Error(result.message);
        // A changing review list may repeat an item across windows; do not render it twice.
        const merged = new Map(items.current.map((item) => [keyRef.current(item), item]));
        result.data.assets.forEach((item) => merged.set(keyRef.current(item), item));
        items.current = [...merged.values()];
        nextOffset.current = result.data.nextWindowOffset;
        setAssets(items.current);
        setTotal(result.data.total);
        setTotalPages(result.data.totalPages);
        setHasMoreInPage(nextOffset.current !== null);
        return items.current;
      } finally {
        if (version === generation.current) {
          pending.current = null;
          setIsLoadingMore(false);
        }
      }
    })();
    pending.current = request;
    return request;
  }, []);

  const loadAll = useCallback(async () => {
    const version = generation.current;
    while (nextOffset.current !== null || pending.current) {
      await loadMore(100);
      if (version !== generation.current) return;
    }
    return items.current;
  }, [loadMore]);

  return {
    assets,
    total,
    totalPages,
    isLoading,
    isLoadingMore,
    hasMoreInPage,
    refresh,
    loadMore,
    loadAll,
  };
}
