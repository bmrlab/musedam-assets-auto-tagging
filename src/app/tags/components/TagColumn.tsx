"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { TagNode } from "../types";
import { TagItem } from "./TagItem";

interface TagColumnProps {
  title: string;
  tags: TagNode[];
  level: 1 | 2 | 3;
  selectedId?: string | null;
  canAdd: boolean;
  emptyMessage: string;
  onAddTag: (level: 1 | 2 | 3) => void;
  onSelectTag?: (nodeId: string) => void;
  onEdit: (nodeId: string, newName: string) => boolean;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onRestore: (nodeId: string) => void;
  getNodeId: (node: TagNode) => string;
  className?: string;
  // 用于检查标签详情是否被编辑过
  hasDetailChanges?: (tagId: number) => boolean;
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
}: TagColumnProps) {
  // const activeTags = tags.filter((tag) => !tag.isDeleted);
  const totalCount = tags.length;

  return (
    <div className={cn("flex flex-col items-stretch overflow-hidden", className)}>
      {/* 标题栏 */}
      <div className="flex items-center justify-start px-4 py-3 text-muted-foreground">
        <div className="text-sm">{title}</div>
        <span className="text-xs">({totalCount})</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAddTag(level)}
          disabled={!canAdd}
          className="ml-auto h-6 w-6 p-0"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* 标签列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-8">{emptyMessage}</p>
        ) : (
          <div className="px-2 space-y-1">
            {tags.map((tag) => (
              <TagItem
                key={getNodeId(tag)}
                tag={tag}
                level={level}
                isSelected={selectedId === getNodeId(tag)}
                onSelect={onSelectTag ? () => onSelectTag(getNodeId(tag)) : undefined}
                onEdit={onEdit}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onDelete={onDelete}
                onRestore={onRestore}
                getNodeId={getNodeId}
                hasDetailChanges={tag.id ? hasDetailChanges?.(tag.id) : false}
              />
            ))}
          </div>
        )}
      </div>
      {level === 1 &&
        <div className="w-full h-12 border-t border-t-solid border-t-[#E4E9F2] flex items-center justify-between text-[var(--ant-basic-6)] text-sm leading-[22px] px-1.5">
          <div
            className={cn(
              'w-full h-9 flex items-center justify-between px-2.5 cursor-pointer rounded-lg',
              selectedId === "-1"
                ? 'bg-[var(--ant-primary-1)] text-[var(--ant-primary-6)] font-medium'
                : 'hover:bg-[var(--ant-primary-1)]'
            )}
            onClick={() => {
              onSelectTag?.("-1")
            }}>
            智能标签
          </div>
        </div>
      }
    </div>
  );
}
