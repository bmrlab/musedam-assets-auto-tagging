"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Edit2, Save, Trash2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TagNode } from "../types";

interface TagItemProps {
  tag: TagNode;
  level: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: (nodeId: string, newName: string) => boolean;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onRestore: (nodeId: string) => void;
  getNodeId: (node: TagNode) => string;
}

export function TagItem({
  tag,
  level,
  isSelected = false,
  onSelect,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onRestore,
  getNodeId,
}: TagItemProps) {
  const [editValue, setEditValue] = useState(tag.name);
  const nodeId = getNodeId(tag);

  const handleSave = () => {
    if (!editValue.trim()) {
      toast.error("标签名不能为空");
      return;
    }
    const success = onEdit(nodeId, editValue.trim());
    if (!success) {
      setEditValue(tag.name); // 恢复原值
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(tag.name);
      onCancelEdit(nodeId);
    }
  };

  const handleCancel = () => {
    setEditValue(tag.name);
    onCancelEdit(nodeId);
  };

  if (tag.isEditing) {
    return (
      <div className="flex items-center gap-2 p-2 border rounded">
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入标签名"
          className="flex-1"
          autoFocus
        />
        <Button size="sm" onClick={handleSave} disabled={!editValue.trim()}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center justify-between p-2 rounded border transition-colors", {
        "bg-red-50 border-red-200 text-red-600 opacity-60": tag.isDeleted,
        "hover:bg-muted cursor-pointer": !tag.isDeleted,
        "bg-green-50 border-green-200": tag.verb === "create",
        "bg-blue-50 border-blue-200": tag.verb === "update",
        "bg-primary/10": isSelected && !tag.isDeleted,
      })}
      onClick={!tag.isDeleted ? onSelect : undefined}
    >
      <span className={tag.isDeleted ? "line-through" : ""}>
        {tag.name}
        {tag.verb === "create" && <span className="ml-1 text-xs text-green-600">(新建)</span>}
        {tag.verb === "update" && <span className="ml-1 text-xs text-blue-600">(已修改)</span>}
        {tag.isDeleted && <span className="ml-1 text-xs text-red-600">(将删除)</span>}
        {level < 3 && tag.children.length > 0 && (
          <span className="ml-2 text-xs bg-muted text-muted-foreground px-1 rounded">
            {tag.children.filter((child) => !child.isDeleted).length}
          </span>
        )}
      </span>

      <div className="flex items-center gap-1">
        {tag.isDeleted ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRestore(nodeId);
            }}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit(nodeId);
              }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(nodeId);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
