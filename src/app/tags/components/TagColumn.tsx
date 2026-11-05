"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { List, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { TagNode } from "../types";
import { TagItem } from "./TagItem";
import { TagSortModal } from "./TagSortModal";

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

interface TagColumnProps {
  title: string;
  tags: TagNode[];
  level: number;
  selectedId?: string | null;
  canAdd: boolean;
  emptyMessage: string;
  onAddTag: (level: number) => void;
  onSelectTag?: (nodeId: string) => void;
  onEdit: (nodeId: string, newName: string) => Promise<boolean>;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => Promise<boolean>;
  onRestore: (nodeId: string) => void;
  getNodeId: (node: TagNode) => string;
  className?: string;
  // 用于检查标签详情是否被编辑过
  hasDetailChanges?: (tagId: number) => boolean;
  canEdit?: boolean;
  totalCount?: number;
  showAiTags?: boolean;
  onSortTags?: (level: number, sortedTags: TagNode[]) => void;
}

export function TagColumn({
  title,
  tags,
  level,
  selectedId,
  canAdd,
  emptyMessage,
  onAddTag,
  onSelectTag,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRestore,
  getNodeId,
  className,
  hasDetailChanges,
  canEdit,
  totalCount,
  showAiTags,
  onSortTags,
}: TagColumnProps) {
  const t = useTranslations("TagsPage.TagColumn");
  const [sortTagOpen, setSortTagOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef(0);
  const scrolledSelection = useRef<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => cancelAnimationFrame(scrollFrame.current);
  }, []);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element || !selectedId || scrolledSelection.current === selectedId) return;
    const index = tags.findIndex((tag) => getNodeId(tag) === selectedId);
    if (index < 0) return;
    scrolledSelection.current = selectedId;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight) {
      const nextTop = Math.max(0, top - element.clientHeight / 2);
      element.scrollTop = nextTop;
      setScrollTop(nextTop);
    }
  }, [selectedId, tags, getNodeId]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil((viewportHeight || 480) / ROW_HEIGHT) + OVERSCAN * 2;
  const end = Math.min(tags.length, start + visibleCount);
  const visibleTags = tags.slice(start, end);

  // 处理排序确认
  const handleSortConfirm = (sortedTags: TagNode[]) => {
    if (canEdit && onSortTags) {
      onSortTags(level, sortedTags);
    }
    setSortTagOpen(false);
  };

  return (
    <div className={cn("flex flex-col items-stretch overflow-hidden", className)}>
      {/* 标题栏 */}
      <div className="flex items-center justify-start px-4 py-3 text-basic-5 group">
        <div className="text-sm ">{title}</div>
        <span className="text-xs">({totalCount})</span>
        {canEdit && (
          <div className="items-center justify-end gap-1 flex-1 flex">
            {!!tags.length && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSortTagOpen(true)}
                className="h-6 w-6 p-0 group-hover:opacity-100 opacity-0"
              >
                <List className="h-3 w-3" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAddTag(level)}
              disabled={!canAdd}
              className="h-6 w-6 p-0"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* 标签列表 */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto scrollbar-thin"
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          cancelAnimationFrame(scrollFrame.current);
          scrollFrame.current = requestAnimationFrame(() => setScrollTop(top));
        }}
      >
        {tags.length === 0 ? (
          <p className="text-basic-5 text-sm text-center py-8">{emptyMessage}</p>
        ) : (
          <div className="relative" style={{ height: tags.length * ROW_HEIGHT }}>
            <div className="absolute inset-x-2" style={{ top: start * ROW_HEIGHT }}>
              {visibleTags.map((tag) => {
                const nodeId = getNodeId(tag);
                return (
                  <TagItem
                    key={nodeId}
                    tag={tag}
                    level={level}
                    isSelected={selectedId === nodeId}
                    onSelect={onSelectTag ? () => onSelectTag(nodeId) : undefined}
                    onEdit={onEdit}
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onDelete={onDelete}
                    onRestore={onRestore}
                    getNodeId={getNodeId}
                    canEdit={canEdit}
                    hasDetailChanges={tag.id ? hasDetailChanges?.(tag.id) : false}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
      {level === 1 && showAiTags && (
        <div className="w-full h-12 border-t border-t-solid flex items-center justify-between text-basic-6 text-sm leading-[22px] px-1.5">
          <div
            className={cn(
              "w-full h-9 flex items-center justify-between px-2.5 cursor-pointer rounded-lg",
              selectedId === "-1"
                ? "bg-primary-1 text-primary-6 font-medium"
                : "hover:bg-primary-1",
            )}
            onClick={() => {
              onSelectTag?.("-1");
            }}
          >
            {t("smartTags")}
          </div>
        </div>
      )}

      {/* 标签排序弹窗 */}
      {canEdit && sortTagOpen && (
        <TagSortModal
          open={sortTagOpen}
          onClose={() => setSortTagOpen(false)}
          onConfirm={handleSortConfirm}
          tags={tags}
          level={level}
        />
      )}
    </div>
  );
}
