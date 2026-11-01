"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { createRef, useDeferredValue, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type TagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: TagTreeNode[];
};

type FlattenedTag = {
  id: number;
  level: number;
  name: string;
  path: string[];
};

type DialogTagSelectorProps = {
  tags: TagTreeNode[];
  selectedTagIds: number[];
  onChange: (tagIds: number[]) => void;
  collapsedUntilFocus?: boolean;
  dialogOpen?: boolean;
};

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

/** 面板列数 = 标签最大层级；最后一列只展示、不再向下展开 */
const PANEL_COUNT = MAX_TAG_LEVEL;

/** 首列 200px，中间列 180px，最后一列自适应（列多时容器内横向滚动） */
const PANEL_GRID_TEMPLATE = [
  "200px",
  ...Array.from({ length: Math.max(PANEL_COUNT - 2, 0) }, () => "180px"),
  "minmax(160px, 1fr)",
].join(" ");

/**
 * 激活路径：activePath[i] 为第 i + 1 列中被激活（展开下一列）的节点。
 * 从给定前缀出发，沿每级第一个子节点补齐到 PANEL_COUNT - 1 级。
 */
function extendActivePath(tags: TagTreeNode[], prefix: number[]): number[] {
  const path: number[] = [];
  let nodes = tags;
  for (let i = 0; i < PANEL_COUNT - 1; i++) {
    const wantedId = prefix[i];
    const node =
      wantedId !== undefined ? nodes.find((item) => item.id === wantedId) : i >= prefix.length ? nodes[0] : undefined;
    if (!node) break;
    path.push(node.id);
    nodes = node.children;
  }
  return path;
}

/** 查找从根到目标节点的 ID 路径 */
function findTagIdPath(nodes: TagTreeNode[], tagId: number, prefix: number[] = []): number[] | null {
  for (const node of nodes) {
    const path = [...prefix, node.id];
    if (node.id === tagId) return path;
    const found = findTagIdPath(node.children, tagId, path);
    if (found) return found;
  }
  return null;
}

function flattenTags(nodes: TagTreeNode[], parentPath: string[] = []) {
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
  highlightSelected = false,
  scrollContainerRef,
}: {
  title: string;
  nodes: TagTreeNode[];
  activeId: number | null;
  selectedTagIds: number[];
  onActivate: (id: number) => void;
  onToggle: (id: number) => void;
  t: TranslationFunction;
  highlightSelected?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-basic-3 last:border-r-0">
      <div className="h-[33px] border-b border-basic-3 px-3 py-2 text-[12px] leading-[16px] font-medium tracking-[0] text-basic-5">
        {title}
      </div>
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="px-3 py-6 text-sm text-basic-5">{t("tagSelector.noSelectableTags")}</div>
        ) : (
          <div>
            {nodes.map((node) => {
              const checked = selectedTagIds.includes(node.id);
              const isActive = activeId === node.id;
              const isHighlighted = isActive || (highlightSelected && checked);

              return (
                <div
                  key={node.id}
                  data-tag-id={node.id}
                  className={cn(
                    "flex h-9 items-center justify-between px-3 py-2 transition-colors",
                    isHighlighted && "bg-primary-1",
                    !isHighlighted && "hover:bg-basic-2",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(node.id)}
                      aria-label={t("tagSelector.selectTag", { name: node.name })}
                      className="size-4 border-basic-4 data-[state=checked]:border-primary-6 data-[state=checked]:bg-primary-6"
                    />
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-[14px] leading-[20px] font-normal",
                        isHighlighted ? "text-primary-6" : "text-basic-8",
                      )}
                      onClick={() => onActivate(node.id)}
                    >
                      {node.name}
                    </button>
                  </div>
                  {node.children.length > 0 ? (
                    <button
                      type="button"
                      className="ml-2 inline-flex h-4 w-4 items-center justify-center"
                      onClick={() => onActivate(node.id)}
                      aria-label={t("tagSelector.selectTag", { name: node.name })}
                    >
                      <ChevronRight className="size-4 text-basic-5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DialogTagSelector({
  tags,
  selectedTagIds,
  onChange,
  collapsedUntilFocus = false,
  dialogOpen,
}: DialogTagSelectorProps) {
  const t = useTranslations("Tagging.BrandLibrary") as TranslationFunction;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRefs = useRef(
    Array.from({ length: PANEL_COUNT }, () => createRef<HTMLDivElement>()),
  ).current;
  const [keyword, setKeyword] = useState("");
  const [activePath, setActivePath] = useState<number[]>(() => extendActivePath(tags, []));
  const [isExpanded, setIsExpanded] = useState(!collapsedUntilFocus);
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase());
  const latestSelectedTagId = selectedTagIds.at(-1) ?? null;

  function getNavigationForTagId(tagId: number | null): number[] {
    const path = tagId === null ? null : findTagIdPath(tags, tagId);
    if (!path) return extendActivePath(tags, []);
    // 目标在最后一列时激活其父路径；否则激活到目标本身，并沿首个子节点向下补齐
    return extendActivePath(tags, path.slice(0, PANEL_COUNT - 1));
  }

  function applyNavigation(tagId: number | null) {
    setActivePath(getNavigationForTagId(tagId));
  }

  function scrollPanelsToActive(path: number[], lastPanelTagId: number | null) {
    scrollRefs.forEach((ref, index) => {
      const targetId = index < PANEL_COUNT - 1 ? path[index] : lastPanelTagId;
      if (!targetId || !ref.current) return;
      ref.current.querySelector(`[data-tag-id="${targetId}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function openPanel() {
    const wasCollapsed = !isExpanded;
    setIsExpanded(true);
    if (wasCollapsed && !keyword.trim()) {
      applyNavigation(latestSelectedTagId);
    }
  }

  useEffect(() => {
    applyNavigation(latestSelectedTagId);
  }, [latestSelectedTagId, tags]);

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

  useEffect(() => {
    if (!isExpanded || deferredKeyword) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollPanelsToActive(activePath, latestSelectedTagId);
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isExpanded, deferredKeyword, activePath, latestSelectedTagId]);

  const flattenedTags = flattenTags(tags);
  const selectedTags = selectedTagIds
    .map((tagId) => flattenedTags.find((tag) => tag.id === tagId))
    .filter((tag): tag is FlattenedTag => Boolean(tag));

  const searchResults = deferredKeyword
    ? flattenedTags.filter((tag) => tag.path.join(" / ").toLowerCase().includes(deferredKeyword))
    : [];

  // panelNodes[i] 为第 i + 1 列展示的节点：首列为一级，其余为上一列激活节点的子节点
  const panelNodes: TagTreeNode[][] = [tags];
  for (let i = 1; i < PANEL_COUNT; i++) {
    const activeParent = panelNodes[i - 1].find((tag) => tag.id === activePath[i - 1]);
    panelNodes.push(activeParent?.children ?? []);
  }

  function toggleTag(tagId: number, options?: { clearKeyword?: boolean }) {
    const nextSelected = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    const prevLatest = selectedTagIds.at(-1) ?? null;
    const nextLatest = nextSelected.at(-1) ?? null;

    if (options?.clearKeyword) {
      setKeyword("");
    }

    onChange(nextSelected);

    if (nextLatest !== prevLatest) {
      applyNavigation(nextLatest);
    }
  }

  return (
    <div ref={containerRef} className="w-full space-y-2">
      <div
        className="flex min-h-10 flex-wrap items-center gap-2 rounded-[8px] border border-basic-4 px-2 py-1.5 transition-colors focus-within:border-primary-6"
        onClick={() => openPanel()}
      >
        {selectedTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleTag(tag.id);
            }}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-basic-3 bg-basic-1 px-2 text-[14px] leading-[20px] text-basic-8 transition-colors hover:border-basic-4"
          >
            <span className="max-w-[280px] truncate">{tag.path.join(" > ")}</span>
            <span className="text-basic-5">×</span>
          </button>
        ))}
        <input
          type="text"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onFocus={() => openPanel()}
          onClick={() => openPanel()}
          placeholder={
            selectedTags.length > 0 ? t("tagSelector.continueAdding") : t("tagSelector.searchPlaceholder")
          }
          className="h-7 min-w-[140px] flex-1 appearance-none bg-transparent px-1 text-[14px] leading-[22px] font-normal text-basic-8 outline-none placeholder:text-basic-5 !border-0 !shadow-none !ring-0 focus:!border-0 focus:!shadow-none focus:!ring-0 focus-visible:!border-0 focus-visible:!shadow-none focus-visible:!ring-0"
        />
      </div>

      {isExpanded && deferredKeyword ? (
        <div className="h-[320px] w-full overflow-y-auto rounded-[6px] border border-basic-3 bg-background shadow-[0_6px_16px_0_rgba(87,98,114,0.12)] dark:shadow-[0_6px_16px_0_rgba(0,0,0,0.4)]">
          {searchResults.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-basic-5">
              {t("tagSelector.noSearchResults")}
            </div>
          ) : (
            <div className="divide-y divide-basic-3">
              {searchResults.map((tag) => (
                <label
                  key={tag.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm text-basic-8 hover:bg-basic-2"
                >
                  <Checkbox
                    checked={selectedTagIds.includes(tag.id)}
                    onCheckedChange={() => toggleTag(tag.id, { clearKeyword: true })}
                    className="border-basic-4 data-[state=checked]:border-primary-6 data-[state=checked]:bg-primary-6"
                  />
                  <span>{tag.path.join(" > ")}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {isExpanded && !deferredKeyword ? (
        <div
          className="grid h-[320px] w-full overflow-x-auto overflow-y-hidden rounded-[6px] border border-basic-3 bg-background shadow-[0_6px_16px_0_rgba(87,98,114,0.12)] dark:shadow-[0_6px_16px_0_rgba(0,0,0,0.4)]"
          style={{ gridTemplateColumns: PANEL_GRID_TEMPLATE }}
        >
          {panelNodes.map((nodes, index) => {
            const isLastPanel = index === PANEL_COUNT - 1;
            return (
              <TagColumn
                key={index}
                title={
                  index === 0
                    ? t("tagSelector.tagGroups", { count: nodes.length })
                    : t("tagSelector.tags", { count: nodes.length })
                }
                nodes={nodes}
                activeId={isLastPanel ? null : (activePath[index] ?? null)}
                selectedTagIds={selectedTagIds}
                onToggle={toggleTag}
                onActivate={
                  isLastPanel
                    ? () => undefined
                    : (id) => setActivePath(extendActivePath(tags, [...activePath.slice(0, index), id]))
                }
                t={t}
                highlightSelected={isLastPanel}
                scrollContainerRef={scrollRefs[index]}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
