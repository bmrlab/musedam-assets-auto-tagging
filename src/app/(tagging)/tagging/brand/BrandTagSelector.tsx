"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { BrandTagTreeNode } from "./types";

type FlattenedTag = {
  id: number;
  level: number;
  name: string;
  path: string[];
};

type BrandTagSelectorProps = {
  tags: BrandTagTreeNode[];
  selectedTagIds: number[];
  onChange: (tagIds: number[]) => void;
  collapsedUntilFocus?: boolean;
  dialogOpen?: boolean;
};

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

function flattenTags(nodes: BrandTagTreeNode[], parentPath: string[] = []) {
  const results: FlattenedTag[] = [];

  for (const node of nodes) {
    const path = [...parentPath, node.name];
    results.push({
      id: node.id,
      level: node.level,
      name: node.name,
      path,
    });

    if (node.children.length > 0) {
      results.push(...flattenTags(node.children, path));
    }
  }

  return results;
}

function TagColumn({
  title,
  nodes,
  activeId,
  selectedTagIds,
  onActivate,
  onToggle,
  t,
}: {
  title: string;
  nodes: BrandTagTreeNode[];
  activeId: number | null;
  selectedTagIds: number[];
  onActivate: (id: number) => void;
  onToggle: (id: number) => void;
  t: TranslationFunction;
}) {
  return (
    <div className="flex min-h-0 flex-col border-r last:border-r-0">
      <div className="border-b bg-white px-4 py-3 text-[12px] leading-[16px] font-medium text-[#8F9BB3]">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <div className="px-3 py-6 text-sm text-basic-5">{t("tagSelector.noSelectableTags")}</div>
        ) : (
          <div className="space-y-1">
            {nodes.map((node) => {
              const checked = selectedTagIds.includes(node.id);
              const isActive = activeId === node.id;

              return (
                <div
                  key={node.id}
                  className={cn(
                    "flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[14px] leading-[22px] font-normal text-basic-8 transition-colors",
                    isActive && "bg-[#F2F6FF] text-[#3366FF]",
                    !isActive && "hover:bg-basic-2/60",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(node.id)}
                    aria-label={t("tagSelector.selectTag", { name: node.name })}
                    className="border-[#C5CEE0] data-[state=checked]:border-[#3366FF] data-[state=checked]:bg-[#3366FF]"
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onActivate(node.id)}
                  >
                    <span className="truncate">{node.name}</span>
                    {node.children.length > 0 ? (
                      <ChevronRight
                        className={cn("ml-auto size-4 text-basic-5", isActive && "text-[#3366FF]")}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BrandTagSelector({
  tags,
  selectedTagIds,
  onChange,
  collapsedUntilFocus = false,
  dialogOpen,
}: BrandTagSelectorProps) {
  const t = useTranslations("Tagging.BrandLibrary") as TranslationFunction;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [keyword, setKeyword] = useState("");
  const [activeLevel1Id, setActiveLevel1Id] = useState<number | null>(tags[0]?.id ?? null);
  const [activeLevel2Id, setActiveLevel2Id] = useState<number | null>(
    tags[0]?.children[0]?.id ?? null,
  );
  const [isExpanded, setIsExpanded] = useState(!collapsedUntilFocus);
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());

  useEffect(() => {
    setActiveLevel1Id(tags[0]?.id ?? null);
    setActiveLevel2Id(tags[0]?.children[0]?.id ?? null);
  }, [tags]);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    setIsExpanded(!collapsedUntilFocus);
  }, [collapsedUntilFocus, dialogOpen]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(target)) {
        setIsExpanded(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isExpanded]);

  const flattenedTags = flattenTags(tags);
  const selectedTags = selectedTagIds
    .map((tagId) => flattenedTags.find((tag) => tag.id === tagId))
    .filter((tag): tag is FlattenedTag => Boolean(tag));

  const searchResults = deferredKeyword
    ? flattenedTags.filter((tag) => tag.path.join(" / ").toLowerCase().includes(deferredKeyword))
    : [];

  const activeLevel1 = tags.find((tag) => tag.id === activeLevel1Id) ?? null;
  const level2Nodes = activeLevel1?.children ?? [];
  const activeLevel2 = level2Nodes.find((tag) => tag.id === activeLevel2Id) ?? null;
  const level3Nodes = activeLevel2?.children ?? [];

  function toggleTag(tagId: number) {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
      return;
    }

    onChange([...selectedTagIds, tagId]);
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div
        className="flex min-h-10 flex-wrap items-center gap-2 rounded-[8px] border border-[#C5CEE0] px-2 py-1.5 transition-colors focus-within:border-[#3366FF]"
        onClick={() => setIsExpanded(true)}
      >
        {selectedTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleTag(tag.id);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#E4E9F2] bg-[#F7F9FC] px-2 text-[14px] leading-[20px] text-[#2E3A59] transition-colors hover:border-[#C5CEE0]"
          >
            <span className="max-w-[280px] truncate">{tag.path.join(" > ")}</span>
            <span className="text-[#8F9BB3]">×</span>
          </button>
        ))}
        <input
          type="text"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onFocus={() => setIsExpanded(true)}
          placeholder={
            selectedTags.length > 0 ? t("tagSelector.continueAdding") : t("tagSelector.searchPlaceholder")
          }
          className="h-7 min-w-[140px] flex-1 appearance-none bg-transparent px-1 text-[14px] leading-[22px] font-normal text-[#2E3A59] outline-none placeholder:text-[#8F9BB3] !border-0 !shadow-none !ring-0 focus:!border-0 focus:!shadow-none focus:!ring-0 focus-visible:!border-0 focus-visible:!shadow-none focus-visible:!ring-0"
        />
      </div>

      {isExpanded && deferredKeyword ? (
        <div className="max-h-[360px] overflow-y-auto rounded-[10px] border border-basic-4 bg-white shadow-[0_8px_24px_rgba(31,48,86,0.08)]">
          {searchResults.length === 0 ? (
            <div className="px-4 py-8 text-sm text-basic-5">{t("tagSelector.noSearchResults")}</div>
          ) : (
            <div className="divide-y">
              {searchResults.map((tag) => (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm text-basic-8"
                >
                  <Checkbox
                    checked={selectedTagIds.includes(tag.id)}
                    onCheckedChange={() => toggleTag(tag.id)}
                    className="border-[#C5CEE0] data-[state=checked]:border-[#3366FF] data-[state=checked]:bg-[#3366FF]"
                  />
                  <span>{tag.path.join(" > ")}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {isExpanded && !deferredKeyword ? (
        <div className="grid h-[340px] grid-cols-1 overflow-hidden rounded-[10px] border border-basic-4 bg-white shadow-[0_8px_24px_rgba(31,48,86,0.08)] md:grid-cols-3">
          <TagColumn
            title={t("tagSelector.tagGroups", { count: tags.length })}
            nodes={tags}
            activeId={activeLevel1Id}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={(id) => {
              setActiveLevel1Id(id);
              const nextLevel2 = tags.find((tag) => tag.id === id)?.children[0]?.id ?? null;
              setActiveLevel2Id(nextLevel2);
            }}
            t={t}
          />
          <TagColumn
            title={t("tagSelector.tags", { count: level2Nodes.length })}
            nodes={level2Nodes}
            activeId={activeLevel2Id}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={setActiveLevel2Id}
            t={t}
          />
          <TagColumn
            title={t("tagSelector.tags", { count: level3Nodes.length })}
            nodes={level3Nodes}
            activeId={null}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={() => undefined}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
