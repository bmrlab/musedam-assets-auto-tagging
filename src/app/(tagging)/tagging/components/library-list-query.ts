// 特征库（品牌/IP/人物/商品）列表的服务端分页参数。
// 纯函数与类型，客户端 hook 和各库的 server action 共用。

export type LibraryListSortOrder = "newest" | "oldest" | "name-asc" | "name-desc";

export type LibraryListQuery = {
  page: number;
  pageSize: number;
  search: string;
  /** "all" 或类型 id */
  typeFilter: string;
  /** "all" 或处理状态 */
  statusFilter: string;
  /** "all" | "enabled" | "disabled" */
  enabledFilter: string;
  sortOrder: LibraryListSortOrder;
};

export type LibraryListPage<T> = {
  items: T[];
  /** 当前筛选条件下的总条数 */
  total: number;
  /** 整个库（不受筛选影响）中被条目引用的类型 id，用于判断类型能否删除 */
  usedTypeIds: string[];
};

export const LIBRARY_PAGE_SIZES = [20, 40, 80] as const;

export const DEFAULT_LIBRARY_LIST_QUERY: LibraryListQuery = {
  page: 1,
  pageSize: 40,
  search: "",
  typeFilter: "all",
  statusFilter: "all",
  enabledFilter: "all",
  sortOrder: "newest",
};

const PROCESS_STATUSES = ["pending", "processing", "completed", "failed"] as const;
const SORT_ORDERS: LibraryListSortOrder[] = ["newest", "oldest", "name-asc", "name-desc"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** server action 的入参来自客户端，逐项校验后再拼查询。 */
export function normalizeLibraryListQuery(input: Partial<LibraryListQuery>): LibraryListQuery {
  const page = Number(input.page);
  const pageSize = Number(input.pageSize);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (LIBRARY_PAGE_SIZES as readonly number[]).includes(pageSize)
      ? pageSize
      : DEFAULT_LIBRARY_LIST_QUERY.pageSize,
    search: typeof input.search === "string" ? input.search.trim().slice(0, 255) : "",
    typeFilter:
      typeof input.typeFilter === "string" && UUID_PATTERN.test(input.typeFilter)
        ? input.typeFilter
        : "all",
    statusFilter: (PROCESS_STATUSES as readonly string[]).includes(input.statusFilter ?? "")
      ? (input.statusFilter as string)
      : "all",
    enabledFilter:
      input.enabledFilter === "enabled" || input.enabledFilter === "disabled"
        ? input.enabledFilter
        : "all",
    sortOrder: SORT_ORDERS.includes(input.sortOrder as LibraryListSortOrder)
      ? (input.sortOrder as LibraryListSortOrder)
      : "newest",
  };
}

/**
 * 生成各库通用的 where / orderBy / skip / take。类型字段名各库不同（logoTypeId、ipTypeId…），
 * 由调用方用返回的 typeId 自行拼到 where 上。
 */
export function buildLibraryListArgs(query: LibraryListQuery) {
  const where = {
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.statusFilter !== "all"
      ? { status: query.statusFilter as (typeof PROCESS_STATUSES)[number] }
      : {}),
    ...(query.enabledFilter !== "all" ? { enabled: query.enabledFilter === "enabled" } : {}),
  };
  // 加 id 作为次序键，保证同名/同时间的条目在翻页时顺序稳定、不重复不遗漏。
  const orderBy =
    query.sortOrder === "name-asc" || query.sortOrder === "name-desc"
      ? [
          { name: query.sortOrder === "name-asc" ? ("asc" as const) : ("desc" as const) },
          { id: "asc" as const },
        ]
      : [
          { createdAt: query.sortOrder === "newest" ? ("desc" as const) : ("asc" as const) },
          { id: query.sortOrder === "newest" ? ("desc" as const) : ("asc" as const) },
        ];

  return {
    where,
    typeId: query.typeFilter !== "all" ? query.typeFilter : undefined,
    orderBy,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}
