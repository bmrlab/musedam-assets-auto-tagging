"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import { TagNode } from "../types";
import { SmartTagsContent } from "./SmartTags";
import { TagColumn } from "./TagColumn";

/** 智能标签入口在一级列中的虚拟 ID */
const SMART_TAGS_ID = "-1";

/** 4 列及以上时每列的最小宽度；区域不够宽时列区域内部横向滚动，足够宽时等分铺满 */
const MULTI_COLUMN_MIN_WIDTH = 240;

interface TagLevelColumnsProps {
  title?: string;
  /** 标题栏右侧内容，例如「设置」 */
  headerExtra?: ReactNode;
  /** 展示的层级列数，默认 MAX_TAG_LEVEL */
  levelCount?: number;

  /** lists[i] 为第 i + 1 级的标签列表 */
  lists: TagNode[][];
  /** selectedIds[i] 为第 i + 1 级选中的节点 ID */
  selectedIds: (string | null | undefined)[];
  onSelect?: (level: number, nodeId: string) => void;

  // 编辑相关回调
  onEdit?: (nodeId: string, newName: string) => Promise<boolean>;
  onStartEdit?: (nodeId: string) => void;
  onCancelEdit?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => Promise<boolean>;
  onRestore?: (nodeId: string) => void;
  onAddTag?: (level: number) => void;

  // 工具函数
  getNodeId?: (node: TagNode) => string;
  hasDetailChanges?: (tagId: number) => boolean;

  // 配置选项
  showAdd?: boolean;
  showAiTags?: boolean;

  // 样式
  className?: string;
  canEdit?: boolean;

  // 排序回调
  onSortTags?: (level: number, sortedTags: TagNode[]) => void;

  // 加载状态
  loading?: boolean;
}

const defaultGetNodeId = (node: TagNode) => (node.id ? node.id.toString() : node.tempId!);
const noop = () => {};
const asyncFalse = async () => false;

/** 按层级渲染标签列（一级为标签组，其余为标签），列数由 levelCount / MAX_TAG_LEVEL 决定 */
export function TagLevelColumns({
  title,
  headerExtra,
  levelCount = MAX_TAG_LEVEL,
  lists,
  selectedIds,
  onSelect,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRestore,
  onAddTag,
  getNodeId = defaultGetNodeId,
  hasDetailChanges,
  showAdd = true,
  showAiTags = true,
  className,
  canEdit,
  onSortTags,
  loading = false,
}: TagLevelColumnsProps) {
  const t = useTranslations("TagsPage");
  const levels = Array.from({ length: levelCount }, (_, i) => i + 1);

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${levelCount}, minmax(0, 1fr))`,
    minWidth: levelCount >= 4 ? levelCount * MULTI_COLUMN_MIN_WIDTH : undefined,
  };

  const getList = (level: number) => lists[level - 1] ?? [];
  const getSelectedId = (level: number) => selectedIds[level - 1] ?? null;
  const getSelectedNode = (level: number) => {
    const id = getSelectedId(level);
    return id ? (getList(level).find((tag) => getNodeId(tag) === id) ?? null) : null;
  };

  const isSmartTagsSelected = getSelectedId(1) === SMART_TAGS_ID;

  const renderColumn = (level: number) => {
    const list = getList(level);
    const parent = level > 1 ? getSelectedNode(level - 1) : null;
    const canAdd = level === 1 ? showAdd : showAdd && !!parent && !parent.isDeleted;
    const emptyMessage =
      level === 1 ? (canEdit ? t("noTagGroups") : "") : parent ? t("noTags") : "";

    return (
      <TagColumn
        key={level}
        title={level === 1 ? t("tagGroup") : t("tag")}
        tags={list}
        level={level}
        selectedId={getSelectedId(level)}
        canAdd={canAdd}
        emptyMessage={emptyMessage}
        onAddTag={onAddTag || noop}
        onSelectTag={onSelect ? (nodeId) => onSelect(level, nodeId) : undefined}
        onEdit={onEdit || asyncFalse}
        onStartEdit={onStartEdit || noop}
        onCancelEdit={onCancelEdit || noop}
        onDelete={onDelete || asyncFalse}
        onRestore={onRestore || noop}
        getNodeId={getNodeId}
        hasDetailChanges={hasDetailChanges}
        canEdit={canEdit}
        totalCount={list.length}
        showAiTags={level === 1 ? showAiTags : undefined}
        onSortTags={onSortTags}
      />
    );
  };

  return (
    <div
      className={cn(
        "flex-1 min-w-0 bg-background border h-full rounded-md overflow-hidden flex flex-col",
        className,
      )}
    >
      {title && (
        <div className="border-b px-4 py-2 font-medium leading-8 flex items-center justify-between gap-3">
          <span>{title}</span>
          {headerExtra}
        </div>
      )}
      {/* 列区域：列总宽超出时在这里横向滚动，而不是整页滚动 */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-thin">
        {loading ? (
          <div className="grid h-full [&>div+div]:border-l" style={gridStyle}>
            {levels.map((col) => (
              <div key={col} className="flex flex-col p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-8" />
                </div>
                {[1, 2, 3, 4, 5].map((item) => (
                  <Skeleton key={item} className="h-9 w-full" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid h-full [&>div+div]:border-l" style={gridStyle}>
            {renderColumn(1)}
            {isSmartTagsSelected ? (
              // 智能标签面板占满一级列之外的所有列
              <div
                className="flex flex-col items-stretch overflow-hidden"
                style={{
                  gridColumn: `span ${Math.max(levelCount - 1, 1)} / span ${Math.max(levelCount - 1, 1)}`,
                }}
              >
                <SmartTagsContent />
              </div>
            ) : (
              levels.slice(1).map((level) => renderColumn(level))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
