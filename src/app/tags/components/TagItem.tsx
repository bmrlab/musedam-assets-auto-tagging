"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { Edit, MoreHorizontal, Search, TagIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { TagNode } from "../types";

interface TagItemProps {
  tag: TagNode;
  level: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: (nodeId: string, newName: string) => Promise<boolean>;
  onStartEdit: (nodeId: string) => void;
  onCancelEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onRestore: (nodeId: string) => void;
  getNodeId: (node: TagNode) => string;
  // 标签详情是否被编辑过
  hasDetailChanges?: boolean;
  canEdit?: boolean;
}

export function TagItem({
  tag,
  // level,
  isSelected = false,
  onSelect,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  // onRestore,
  getNodeId,
  hasDetailChanges = false,
  canEdit,
}: TagItemProps) {
  const t = useTranslations("TagsPage.TagItem");
  const tRoot = useTranslations("TagsPage");
  const [editValue, setEditValue] = useState(tag.name);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const nodeId = getNodeId(tag);

  const handleSave = async () => {
    if (!editValue.trim()) {
      toast.error(t("tagNameRequired"));
      return;
    }
    const success = await onEdit(nodeId, editValue.trim());
    if (!success) {
      setEditValue(tag.name); // 恢复原值
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      await handleSave();
    } else if (e.key === "Escape") {
      setEditValue(tag.name);
      onCancelEdit(nodeId);
    }
  };

  // const handleCancel = () => {
  //   setEditValue(tag.name);
  //   onCancelEdit(nodeId);
  // };

  // const handleEditClick = () => {
  //   setDropdownOpen(false);
  //   onStartEdit(nodeId);
  // };

  const handleDeleteClick = () => {
    setDropdownOpen(false);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    setDeleteDialogOpen(false);
    onDelete(nodeId);
  };

  const handleRename = () => {
    setDropdownOpen(false);
    onStartEdit(nodeId);
  };
  if (tag.isDeleted) {
    return null;
  }

  // 编辑状态的渲染
  if (tag.isEditing) {
    return (
      <div className="h-9 flex items-center gap-1 px-2 border rounded-md">
        <TagIcon className="size-3" />
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          placeholder={t("inputTagName")}
          className="flex-1 h-6 p-0 shadow-none border-none rounded-none text-sm"
          autoFocus
        />
        {/* <Button
          size="icon"
          variant="ghost"
          onClick={handleSave}
          disabled={!editValue.trim()}
          className="bg-transparent hover:bg-transparent cursor-pointer size-7 p-1"
        >
          <Save className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleCancel}
          className="bg-transparent hover:bg-transparent cursor-pointer size-7 p-1"
        >
          <X className="h-3 w-3" />
        </Button> */}
      </div>
    );
  }

  // 正常状态的渲染
  return (
    <>
      <div
        className={cn(
          "h-9 group flex items-center justify-between px-2 rounded-sm",
          "cursor-pointer transition-all duration-300 ease-in-out",
          isSelected ? "bg-primary-1 text-primary-6 font-medium" : "hover:bg-primary-1",
          // {
          //   "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 opacity-60": tag.isDeleted,
          //   "hover:bg-basic-3": !tag.isDeleted && !isSelected,
          //   "bg-green-50 dark:bg-green-950/30": tag.verb === "create" && !isSelected,
          //   "bg-blue-50 dark:bg-blue-950/30": tag.verb === "update" && !isSelected,
          //   "bg-accent text-accent-foreground": isSelected && !tag.isDeleted,
          // },
        )}
        onClick={!tag.isDeleted ? onSelect : undefined}
      >
        <div className="flex-1 flex items-center gap-2">
          <TagIcon className="size-3" />
          <span
            className={cn("text-sm font-medium truncate", {
              "line-through": tag.isDeleted,
            })}
          >
            {tag.name}
          </span>

          {/* 标签上的素材数量 */}
          {/* {level < 3 && tag.children.length > 0 && (
          <span className="text-xs text-basic-5 bg-muted px-1.5 py-0.5 rounded">
            {tag.children.filter((child) => !child.isDeleted).length}
          </span>
        )} */}

          {/* 状态标签 */}
          {/* {tag.verb === "create" && (
          <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">{t("new")}</span>
        )}
        {tag.verb === "update" && (
          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{t("modified")}</span>
        )}
        {tag.isDeleted && (
          <span className="text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">{t("toBeDeleted")}</span>
        )} */}
          {/* 标签详情编辑状态 */}
          {/* {hasDetailChanges && !tag.verb && !tag.isDeleted && (
          <span className="text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded">
            {t("edited")}
          </span>
        )} */}
        </div>

        {/* 操作按钮 */}
        {canEdit && (
          <div className="flex items-center">
            {tag.isDeleted ? (
              <></>
            ) : (
              // <Button
              //   size="icon"
              //   variant="ghost"
              //   onClick={(e) => {
              //     e.stopPropagation();
              //      onRestore(nodeId);
              //   }}
              //   className="bg-transparent hover:bg-transparent opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              // >
              //   <Undo2 className="h-3 w-3" />
              // </Button>
              <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => e.stopPropagation()}
                    className="size-6 rounded-sm bg-transparent hover:bg-transparent opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="w-40">
                  <DropdownMenuItem
                    onClick={() => {
                      const searchUrl = `/home/all?filter=${encodeURIComponent(
                        encodeURIComponent(JSON.stringify({ tags: [tag.id], tagIncEx: true })),
                      )}`;
                      dispatchMuseDAMClientAction("goto", {
                        url: searchUrl,
                      });
                    }}
                  >
                    <Search className="h-3 w-3 text-current" />
                    {t("searchRelatedAssets")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleRename}>
                    <Edit className="h-3 w-3 text-current" />
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDeleteClick}
                    className="text-sm !text-danger-6"
                  >
                    <Trash2Icon className="h-3 w-3 text-current" />
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDescription", { tagName: tag.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tRoot("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {t("confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
