"use client";

import { cn } from "@/lib/utils";
import { useCallback, useState, type UIEvent } from "react";

// 特征库列表表格的公共布局：
// - 表格外层容器同时负责横向和纵向滚动（分页栏在它外面，始终可见），sticky 表头 / 左侧固定列都以它为滚动容器；
// - border-separate：border-collapse 下 sticky 单元格的边框不会跟着单元格走，改由单元格自己画底边；
// - 表头纵向滚动时吸顶；勾选列 + 名称列横向滚动时固定在左侧，名称列右侧在横向滚动后显示分隔阴影。

/** 列表内容滚动容器（放在列表卡片内，分页栏之上） */
export const libraryTableScrollClassName = "min-h-0 flex-1 overflow-auto";

export const libraryTableClassName = cn(
  "min-w-full table-auto border-separate border-spacing-0",
  "[&_th]:font-medium [&_th]:leading-5 [&_th]:align-middle [&_th]:whitespace-nowrap [&_th]:border-b",
  "[&_td]:leading-5 [&_td]:align-middle [&_td]:whitespace-nowrap [&_td]:border-b",
  "[&_tbody_tr:last-child_td]:border-b-0",
  "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-background",
);

const CHECKBOX_COLUMN_WIDTH = "w-[40px] min-w-[40px] max-w-[40px]";
const NAME_COLUMN_SHADOW = "shadow-[6px_0_6px_-6px_rgba(0,0,0,0.18)]";

/** 勾选列表头：表头已经 sticky top-0，这里再固定到左侧，并压在其他表头之上 */
export const stickyCheckboxHeaderClassName = cn("left-0 !z-30", CHECKBOX_COLUMN_WIDTH);
export const stickyCheckboxCellClassName = cn(
  "sticky left-0 z-10 bg-background",
  CHECKBOX_COLUMN_WIDTH,
);

/** 名称列固定在勾选列右侧；scrolledX 为 true（已横向滚动）时显示右侧分隔阴影 */
export function stickyNameHeaderClassName(scrolledX: boolean) {
  return cn("left-[40px] !z-30", scrolledX && NAME_COLUMN_SHADOW);
}

export function stickyNameCellClassName(scrolledX: boolean) {
  return cn("sticky left-[40px] z-10 bg-background", scrolledX && NAME_COLUMN_SHADOW);
}

/** 记录表格容器是否已横向滚动，用于切换名称列的分隔阴影 */
export function useHorizontalScrolled() {
  const [scrolledX, setScrolledX] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const next = event.currentTarget.scrollLeft > 0;
    setScrolledX((current) => (current === next ? current : next));
  }, []);
  return { scrolledX, onScroll };
}
