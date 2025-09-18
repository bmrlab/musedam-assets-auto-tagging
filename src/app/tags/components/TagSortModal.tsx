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
import { TagNode } from "../types";
import { useEffect, useState } from 'react'

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
    isLoading = false,
}: TagSortModalProps) {
    const [sortedTags, setSortedTags] = useState<TagNode[]>([...tags]);
    const [isDragging, setIsDragging] = useState(false);
    // 当弹窗打开时，重置排序列表
    useEffect(() => {
        if (open) {
            setSortedTags([...tags]);
        }
    }, [open, tags]);

    // 处理拖拽开始
    const handleDragStart = (e: React.DragEvent, index: number) => {
        e.stopPropagation()
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
    const handleConfirm = () => {
        onConfirm(sortedTags);
    };

    // 获取层级标题
    const getLevelTitle = () => {
        switch (level) {
            case 1:
                return "一级标签";
            case 2:
                return "二级标签";
            case 3:
                return "三级标签";
            default:
                return "标签";
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>标签排序</DialogTitle>
                    <DialogDescription>
                        {getLevelTitle()}({tags.length})
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-96 overflow-y-auto py-2 px-2 border rounded-lg">
                    <div className="space-y-1">
                        {sortedTags.map((tag, index) => (
                            <div
                                key={tag.id || tag.tempId || index}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnd={handleDragEnd}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, index)}
                                className={cn(
                                    "group flex items-center justify-between w-full h-8 px-2.5 py-1 rounded-lg",
                                    "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-move",
                                    isDragging && "opacity-50"
                                )}
                            >
                                <div className="flex items-center flex-1 min-w-0">
                                    <div className="w-5 h-5 flex justify-center items-center mr-1">
                                        <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
                                    </div>
                                    <Tag className="w-4 h-4 text-gray-400 mr-1.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm leading-5 truncate">
                                            {tag.name}
                                        </span>
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
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button onClick={handleConfirm} disabled={isLoading}>
                        {isLoading ? "保存中..." : "确认"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
