"use client";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { TagNode } from "../types";
import { ThreeTagList } from "./ThreeTagList";

export interface NameChildList {
  name: string;
  nameChildList?: NameChildList[];
}

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

// 解析批量文本为三级结构
export const parseNameChildList = (text: string): NameChildList[] => {
  if (!text) return [];
  const lines = text.split("\n").filter((line) => line.trim());
  const result: NameChildList[] = [];
  let currentL1: NameChildList | null = null;
  let currentL2: NameChildList | null = null;

  for (const line of lines) {
    if (line.startsWith("# ") || (line.startsWith("#") && !line.startsWith("##"))) {
      const name = line.startsWith("# ") ? line.slice(2).trim() : line.slice(1).trim();
      if (!name) continue;
      currentL1 = { name, nameChildList: [] };
      currentL2 = null;
      result.push(currentL1);
    } else if (line.startsWith("## ") || (line.startsWith("##") && !line.startsWith("###"))) {
      if (!currentL1) continue;
      const name = line.startsWith("## ") ? line.slice(3).trim() : line.slice(2).trim();
      if (!name) continue;
      currentL2 = { name, nameChildList: [] };
      currentL1.nameChildList?.push(currentL2);
    } else if (line.trim() && !line.startsWith("#")) {
      if (!currentL2) continue;
      currentL2.nameChildList?.push({ name: line.trim() });
    }
  }
  return result;
};

// NameChildList -> TagNode (用于预览)
export const convertToTagNodes = (nameChildList: NameChildList[]): TagNode[] => {
  return nameChildList.map((item, index) => ({
    id: undefined,
    slug: null,
    name: item.name,
    originalName: item.name,
    children: item.nameChildList ? convertToTagNodes(item.nameChildList) : [],
    tempId: `preview_${index}`,
  }));
};

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

  const nameChildList = useMemo(() => parseNameChildList(value), [value]);
  const previewTagNodes = useMemo(() => convertToTagNodes(nameChildList), [nameChildList]);

  const [previewSelectedLevel1Id, setPreviewSelectedLevel1Id] = useState<string | null>(null);
  const [previewSelectedLevel2Id, setPreviewSelectedLevel2Id] = useState<string | null>(null);
  const [previewSelectedLevel3Id, setPreviewSelectedLevel3Id] = useState<string | null>(null);

  useEffect(() => {
    // 输入变化时，清理预览选中
    setPreviewSelectedLevel1Id(null);
    setPreviewSelectedLevel2Id(null);
    setPreviewSelectedLevel3Id(null);
  }, [value]);

  const previewList1 = previewTagNodes;
  const previewList2 = useMemo(() => {
    if (!previewSelectedLevel1Id) return [];
    const selectedNode = previewTagNodes.find((node) => node.tempId === previewSelectedLevel1Id);
    return selectedNode?.children || [];
  }, [previewTagNodes, previewSelectedLevel1Id]);
  const previewList3 = useMemo(() => {
    if (!previewSelectedLevel2Id) return [];
    const selectedNode = previewList2.find((node) => node.tempId === previewSelectedLevel2Id);
    return selectedNode?.children || [];
  }, [previewList2, previewSelectedLevel2Id]);

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
              <ThreeTagList
                list1={previewList1}
                list2={previewList2}
                list3={previewList3}
                total1={previewList1.length}
                total2={previewList2.length}
                total3={previewList3.length}
                selectedLevel1Id={previewSelectedLevel1Id}
                selectedLevel2Id={previewSelectedLevel2Id}
                selectedLevel3Id={previewSelectedLevel3Id}
                onSelectLevel1={(nodeId) => {
                  setPreviewSelectedLevel1Id(nodeId);
                  setPreviewSelectedLevel2Id(null);
                  setPreviewSelectedLevel3Id(null);
                }}
                onSelectLevel2={(nodeId) => {
                  setPreviewSelectedLevel2Id(nodeId);
                  setPreviewSelectedLevel3Id(null);
                }}
                onSelectLevel3={(nodeId) => setPreviewSelectedLevel3Id(nodeId)}
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
