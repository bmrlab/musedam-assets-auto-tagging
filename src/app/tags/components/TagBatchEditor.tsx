"use client";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import { nameChildListToPreviewTagNodes, parseBatchTagText } from "../batchTagText";
import { TagNode } from "../types";
import { TagLevelColumns } from "./TagLevelColumns";

export interface TagBatchEditorProps {
  value: string;
  onChange?: (value: string) => void;
  mode?: "preview" | "edit";
  onModeChange?: (mode: "preview" | "edit") => void;
  readOnly?: boolean;
  showModeSwitcher?: boolean;
  className?: string;
  placeholderContent?: ReactNode;
}

export const TagBatchEditor = ({
  value,
  onChange,
  mode: outerMode,
  onModeChange,
  readOnly,
  showModeSwitcher = true,
  className,
  placeholderContent,
}: TagBatchEditorProps) => {
  const t = useTranslations("TagsPage.ManualCreateModal");
  const [innerMode, setInnerMode] = useState<"preview" | "edit">("edit");
  const mode = outerMode ?? innerMode;
  const setMode = (m: "preview" | "edit") => {
    if (onModeChange) onModeChange(m);
    if (outerMode === undefined) setInnerMode(m);
  };

  const [showTips, setShowTips] = useState(true);

  useEffect(() => {
    if (!value) setShowTips(true);
  }, [value]);

  // 与创建逻辑共用同一解析器（支持最多四级），预览 tempId 按路径生成保证唯一
  const nameChildList = useMemo(() => parseBatchTagText(value), [value]);
  const previewTagNodes = useMemo(
    () => nameChildListToPreviewTagNodes(nameChildList),
    [nameChildList],
  );

  // previewSelectedIds[i] 为预览中第 i + 1 级选中的节点 tempId
  const [previewSelectedIds, setPreviewSelectedIds] = useState<(string | null)[]>([]);

  useEffect(() => {
    // 输入变化时，默认选中第一个一级标签及其第一个二级标签
    const firstLevel1 = previewTagNodes[0];
    const firstLevel2 = firstLevel1?.children[0];
    setPreviewSelectedIds([firstLevel1?.tempId ?? null, firstLevel2?.tempId ?? null]);
  }, [value, previewTagNodes]);

  // 按选中路径逐级展开每一列的数据
  const previewLists = useMemo(() => {
    const lists: TagNode[][] = [previewTagNodes];
    for (let level = 2; level <= MAX_TAG_LEVEL; level++) {
      const parentId = previewSelectedIds[level - 2];
      const parent = parentId
        ? lists[level - 2].find((node) => node.tempId === parentId)
        : undefined;
      lists.push(parent?.children ?? []);
    }
    return lists;
  }, [previewTagNodes, previewSelectedIds]);

  return (
    <div className={cn("w-full h-full flex flex-col gap-3", className)}>
      {showModeSwitcher && (
        <div className="w-full flex items-center justify-between">
          <div className="text-sm text-basic-5"></div>
          <div className="h-[30px] w-auto rounded-md bg-muted p-0.5 flex items-center space-x-0.5">
            <div
              className={cn(
                "border border-solid rounded flex justify-center items-center px-2 cursor-pointer",
                mode === "preview" ? "border-border bg-background" : "border-transparent",
              )}
              onClick={() => setMode("preview")}
            >
              <div
                className={cn(
                  "text-[13px] leading-[22px] select-none",
                  mode === "preview" ? "font-medium text-foreground" : "text-basic-5",
                )}
              >
                {t("PreviewView")}
              </div>
            </div>
            <div
              className={cn(
                "border border-solid rounded flex justify-center items-center px-2 cursor-pointer",
                mode === "edit" ? "border-border bg-background" : "border-transparent",
              )}
              onClick={() => setMode("edit")}
            >
              <div
                className={cn(
                  "text-[13px] leading-[22px] select-none",
                  mode === "edit" ? "font-medium text-foreground" : "text-basic-5",
                )}
              >
                {t("HereSTheTranslatedTextFollowin")}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <div className="relative w-full h-full">
            {mode === "edit" && !readOnly && (
              <>
                {showTips && !value && (
                  <div className="absolute inset-0 px-4 py-2 text-basic-5 text-sm leading-[22px] font-normal pointer-events-none">
                    {placeholderContent}
                  </div>
                )}
                <Textarea
                  placeholder=""
                  onBlur={() => setShowTips(true)}
                  value={value}
                  containerClassName="h-full"
                  className={cn("relative h-full px-4 py-2", value?.length ? "" : "bg-transparent")}
                  onChange={(e) => onChange?.(e.target.value || "")}
                />
              </>
            )}
            {mode === "preview" && (
              <TagLevelColumns
                lists={previewLists}
                selectedIds={previewSelectedIds}
                onSelect={(level, nodeId) =>
                  setPreviewSelectedIds((prev) => [...prev.slice(0, level - 1), nodeId])
                }
                showAdd={false}
                showAiTags={false}
                getNodeId={(node) => node.tempId || "unknown"}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
