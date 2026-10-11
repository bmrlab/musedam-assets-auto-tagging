"use client";

import { ServerActionResult } from "@/lib/serverAction";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_LIBRARY_LIST_QUERY,
  LibraryListPage,
  LibraryListQuery,
  LibraryListSortOrder,
} from "./library-list-query";

const SEARCH_DEBOUNCE_MS = 300;

type LibraryListFilters = {
  pageSize: number;
  search: string;
  typeFilter: string;
  statusFilter: string;
  enabledFilter: string;
  sortOrder: LibraryListSortOrder;
};

/**
 * 特征库列表的服务端分页状态：筛选/搜索/排序/翻页变化时向服务端取当前页。
 * initialList 必须对应 DEFAULT_LIBRARY_LIST_QUERY（页面服务端渲染时取的第一页）。
 */
export function useLibraryList<T>({
  initialList,
  filters,
  fetchPage,
}: {
  initialList: LibraryListPage<T>;
  filters: LibraryListFilters;
  fetchPage: (query: LibraryListQuery) => Promise<ServerActionResult<LibraryListPage<T>>>;
}) {
  const [items, setItems] = useState(initialList.items);
  const [total, setTotal] = useState(initialList.total);
  const [usedTypeIds, setUsedTypeIds] = useState(initialList.usedTypeIds);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const debouncedSearch = useDebouncedValue(filters.search.trim(), SEARCH_DEBOUNCE_MS);

  const filtersKey = buildFiltersKey({ ...filters, search: debouncedSearch });

  // 筛选条件变化时在渲染阶段直接回到第一页，避免先用旧页码请求一次。
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const requestIdRef = useRef(0);
  const initialKeyRef = useRef<string | null>(`${buildFiltersKey(DEFAULT_LIBRARY_LIST_QUERY)}|1|0`);

  useEffect(() => {
    const requestKey = `${filtersKey}|${page}|${reloadToken}`;
    // 首屏数据已由服务端渲染给出，不重复请求。
    if (initialKeyRef.current === requestKey) {
      initialKeyRef.current = null;
      return;
    }
    initialKeyRef.current = null;

    const baseQuery = JSON.parse(filtersKey) as Omit<LibraryListQuery, "page">;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    void fetchPageRef
      .current({ ...baseQuery, page })
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        if (!result.success) {
          toast.error(result.message);
          return;
        }
        const totalPages = Math.max(1, Math.ceil(result.data.total / baseQuery.pageSize));
        // 删除等操作后当前页可能超出范围，退到最后一页重新取。
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        setItems(result.data.items);
        setTotal(result.data.total);
        setUsedTypeIds(result.data.usedTypeIds);
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [filtersKey, page, reloadToken]);

  /** 重新取当前页（total 与 usedTypeIds 一并刷新）。 */
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /** 回到第一页并重新取，用于新建/导入后让新条目出现在列表里。 */
  const reloadFirstPage = useCallback(() => {
    setPage(1);
    setReloadToken((token) => token + 1);
  }, []);

  return {
    items,
    setItems,
    total,
    usedTypeIds,
    page,
    setPage,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    loading,
    debouncedSearch,
    reload,
    reloadFirstPage,
  };
}

function buildFiltersKey(filters: LibraryListFilters) {
  const query: Omit<LibraryListQuery, "page"> = {
    pageSize: filters.pageSize,
    search: filters.search,
    typeFilter: filters.typeFilter,
    statusFilter: filters.statusFilter,
    enabledFilter: filters.enabledFilter,
    sortOrder: filters.sortOrder,
  };
  return JSON.stringify(query);
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
