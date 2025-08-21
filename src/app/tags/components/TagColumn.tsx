"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { TagItem } from "./TagItem";
import { TagNode } from "../types";

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
}: TagColumnProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Button size="sm" onClick={() => onAddTag(level)} disabled={!canAdd}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">{emptyMessage}</p>
        ) : (
          tags.map((tag) => (
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
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
