"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { GripVertical, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTagSort } from "../actions";
import { TagNode } from "../types";

interface TagSortModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (sortedTags: TagNode[]) => void;
  tags: TagNode[];
  level: 1 | 2 | 3;
  isLoading?: boolean;
}

export function TagSortModal({
  open,
  onClose,
  onConfirm,
  tags,
  level,
  isLoading: externalIsLoading = false,
}: TagSortModalProps) {
  const t = useTranslations("TagsPage.TagSortModal");
  const [sortedTags, setSortedTags] = useState<TagNode[]>([...tags]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // 当弹窗打开时，重置排序列表
  useEffect(() => {
    if (open) {
      setSortedTags([...tags]);
    }
  }, [open, tags]);

  // 处理拖拽开始
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", index.toString());
    setIsDragging(true);
  };

  // 处理拖拽结束
  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // 处理拖拽悬停
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // 处理放置
  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData("text/plain"));

    if (sourceIndex === targetIndex) return;

    const newTags = [...sortedTags];
    const [removed] = newTags.splice(sourceIndex, 1);
    newTags.splice(targetIndex, 0, removed);

    setSortedTags(newTags);
  };

  // 处理确认
  const handleConfirm = async () => {
    try {
      setIsLoading(true);

      // 准备排序数据
      const sortData = sortedTags
        .filter((tag) => tag.id) // 只处理有ID的标签
        .map((tag, index) => ({
          id: tag.id!,
          sort: sortedTags.length - index, // 数字越大越靠前，第一个标签sort值最大
        }));

      if (sortData.length === 0) {
        toast.error(t("noSortableTags"));
        return;
      }

      // 创建带有新sort值的标签数组
      const tagsWithNewSort = sortedTags.map((tag, index) => ({
        ...tag,
        sort: sortedTags.length - index, // 更新sort值
        verb: "update" as const,
      }));

      // 调用排序更新接口-更新数据
      const result = await updateTagSort(sortData);
      if (result.success) {
        onConfirm(tagsWithNewSort); // 传递带有新sort值的标签数组
        onClose();
      } else {
        toast.error(result.message || t("sortSaveFailed"));
      }
    } catch (error) {
      console.error("Sort tags error:", error);
      toast.error(t("sortSaveFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  // 获取层级标题
  const getLevelTitle = () => {
    switch (level) {
      case 1:
        return t("level1Title");
      case 2:
        return t("level2Title");
      case 3:
        return t("level3Title");
      default:
        return t("defaultTitle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {getLevelTitle()}({tags.length})
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-86 overflow-y-auto py-2 px-2 border rounded-[10px]">
          <div className="space-y-1">
            {sortedTags.map((tag, index) => (
              <div
                key={tag.id || tag.tempId || index}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onMouseDown={() => setIsDragging(true)}
                onMouseUp={() => setIsDragging(false)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                className={cn(
                  "group flex items-center justify-between w-full h-8 px-2.5 py-1 rounded-md",
                  "hover:bg-gray-50 dark:hover:bg-gray-800",
                  isDragging ? "cursor-grabbing" : "cursor-grab",
                  isDragging && "opacity-50",
                )}
              >
                <div className="flex items-center flex-1 min-w-0">
                  <div className="w-5 h-5 flex justify-center items-center mr-1">
                    <GripVertical className={cn("w-4 h-4 text-[#c5cee0] hover:text-primary-6", isDragging ? "cursor-grabbing" : "cursor-grab")} />
                  </div>
                  <Tag className="w-4 h-4 text-gray-400 mr-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm leading-5 truncate">{tag.name}</span>
                  </div>
                </div>
                <div className="flex items-center text-gray-400 text-xs leading-4 ml-2">
                  <span>{index + 1}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading || externalIsLoading} size="sm">
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading || externalIsLoading} size="sm">
            {isLoading || externalIsLoading ? t("saving") : t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
