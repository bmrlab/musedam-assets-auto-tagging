"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
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
}: {
  title: string;
  nodes: BrandTagTreeNode[];
  activeId: number | null;
  selectedTagIds: number[];
  onActivate: (id: number) => void;
  onToggle: (id: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col border-r last:border-r-0">
      <div className="border-b bg-[#f7f9fd] px-4 py-3 text-base font-medium text-basic-8">
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length === 0 ? (
          <div className="px-3 py-6 text-sm text-basic-5">暂无可选标签</div>
        ) : (
          <div className="space-y-1">
            {nodes.map((node) => {
              const checked = selectedTagIds.includes(node.id);
              const isActive = activeId === node.id;

              return (
                <div
                  key={node.id}
                  className={cn(
                    "flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] text-basic-8 transition-colors",
                    isActive && "bg-[#eef3ff]",
                    !isActive && "hover:bg-basic-2/60",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(node.id)}
                    aria-label={`选择 ${node.name}`}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onActivate(node.id)}
                  >
                    <span className="truncate">{node.name}</span>
                    {node.children.length > 0 ? (
                      <ChevronRight className="ml-auto size-4 text-basic-5" />
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
    if (!collapsedUntilFocus || !isExpanded) {
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
  }, [collapsedUntilFocus, isExpanded]);

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
      <div className="relative">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onClick={() => setIsExpanded(true)}
          onFocus={() => setIsExpanded(true)}
          placeholder="输入标签关键词搜索或从下方标签体系选择"
          className="h-8 rounded-[6px] border border-[#C5CEE0] pl-3 text-[14px] leading-[22px] font-normal placeholder:text-[14px] placeholder:leading-[22px] placeholder:font-normal placeholder:text-[#8F9BB3]"
        />
      </div>

      {isExpanded && selectedTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className="rounded-full border border-[#d9e2f2] bg-[#f7f9fc] px-3 py-1 text-sm text-basic-8 transition-colors hover:border-primary-5 hover:text-primary"
            >
              {tag.path.join(" > ")}
            </button>
          ))}
        </div>
      ) : null}

      {isExpanded && deferredKeyword ? (
        <div className="max-h-[360px] overflow-y-auto rounded-[10px] border border-basic-4 bg-white shadow-[0_8px_24px_rgba(31,48,86,0.08)]">
          {searchResults.length === 0 ? (
            <div className="px-4 py-8 text-sm text-basic-5">没有搜索到匹配标签</div>
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
            title={`标签组(${tags.length})`}
            nodes={tags}
            activeId={activeLevel1Id}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={(id) => {
              setActiveLevel1Id(id);
              const nextLevel2 = tags.find((tag) => tag.id === id)?.children[0]?.id ?? null;
              setActiveLevel2Id(nextLevel2);
            }}
          />
          <TagColumn
            title={`标签(${level2Nodes.length})`}
            nodes={level2Nodes}
            activeId={activeLevel2Id}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={setActiveLevel2Id}
          />
          <TagColumn
            title={`标签(${level3Nodes.length})`}
            nodes={level3Nodes}
            activeId={null}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onActivate={() => undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
