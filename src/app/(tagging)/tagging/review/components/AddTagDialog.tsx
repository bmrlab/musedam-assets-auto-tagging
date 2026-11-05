"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronRightIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  fetchReviewTagTreeAction,
  type ReviewTagNode,
  type ReviewTagSearchResult,
} from "../actions";

export function AddTagDialog({
  open,
  onOpenChange,
  addedIds,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addedIds: Set<number>;
  onConfirm: (tags: ReviewTagSearchResult[]) => void;
}) {
  const t = useTranslations("Tagging.Review");
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<ReviewTagNode[]>([]);
  const [activePath, setActivePath] = useState<number[]>([]);
  const [selected, setSelected] = useState(new Map<number, ReviewTagSearchResult>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(false);
    fetchReviewTagTreeAction()
      .then((result) => {
        if (!active) return;
        if (!result.success) throw new Error(result.message);
        setNodes(result.data);
      })
      .catch(() => {
        if (active) {
          setNodes([]);
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, retry]);

  const { paths, children } = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const paths = new Map<number, ReviewTagSearchResult>();
    const ancestors = new Map<number, number[]>();
    for (const node of nodes) {
      const chain: ReviewTagNode[] = [];
      const seen = new Set<number>();
      let current: ReviewTagNode | undefined = node;
      while (current && !seen.has(current.id)) {
        chain.unshift(current);
        seen.add(current.id);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
      }
      paths.set(node.id, { id: node.id, tagPath: chain.map((item) => item.name) });
      ancestors.set(
        node.id,
        chain.map((item) => item.id),
      );
    }
    // Keep matching branches and all their ancestors, preserving the column layout during search.
    const keyword = query.trim().toLocaleLowerCase();
    const visible = new Set<number>();
    for (const node of nodes) {
      if (
        !keyword ||
        paths.get(node.id)!.tagPath.join(" > ").toLocaleLowerCase().includes(keyword)
      ) {
        ancestors.get(node.id)!.forEach((id) => visible.add(id));
      }
    }
    const children = new Map<number | null, ReviewTagNode[]>();
    for (const node of nodes) {
      if (!visible.has(node.id)) continue;
      const parentId = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
      const siblings = children.get(parentId) ?? [];
      siblings.push(node);
      children.set(parentId, siblings);
    }
    return { paths, children };
  }, [nodes, query]);

  const columns: ReviewTagNode[][] = [children.get(null) ?? []];
  for (const id of activePath) {
    if (!columns[columns.length - 1].some((node) => node.id === id)) break;
    const next = children.get(id);
    if (!next?.length) break;
    columns.push(next);
  }
  while (columns.length < 3) columns.push([]);
  const picks = [...selected.values()].filter((tag) => !addedIds.has(tag.id));
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(id)) next.delete(id);
      else next.set(id, paths.get(id)!);
      return next;
    });
  const close = (next: boolean) => {
    if (!next) {
      setQuery("");
      setSelected(new Map());
      setNodes([]);
      setActivePath([]);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{t("addTagTitle")}</DialogTitle>
          <DialogDescription>{t("addTagHint")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-basic-5" />
          <Input
            autoFocus
            aria-label={t("addTagSearchPlaceholder")}
            placeholder={t("addTagSearchPlaceholder")}
            value={query}
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
              setActivePath([]);
            }}
          />
        </div>
        <div
          className="min-h-0 overflow-hidden rounded-md border border-basic-3"
          aria-busy={loading}
        >
          {loading ? (
            <div className="flex h-[320px] items-center justify-center">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex h-[320px] flex-col items-center justify-center gap-3 text-sm text-basic-5"
            >
              {t("addTagLoadFailed")}
              <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
                {t("addTagRetry")}
              </Button>
            </div>
          ) : !columns[0].length ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-basic-5">
              {t("addTagNoResults")}
            </div>
          ) : (
            <div className="flex overflow-x-auto">
              {columns.map((column, depth) => (
                <div
                  key={depth}
                  role="group"
                  aria-label={String(depth + 1)}
                  className="h-[min(40vh,360px)] min-h-[240px] min-w-[190px] flex-1 space-y-1 overflow-y-auto border-r border-basic-3 p-1.5 last:border-r-0"
                >
                  {column.map((node) => {
                    const path = paths.get(node.id)!.tagPath.join(" > ");
                    const added = addedIds.has(node.id);
                    const expanded = activePath[depth] === node.id;
                    const hasChildren = Boolean(children.get(node.id)?.length);
                    return (
                      <div
                        key={node.id}
                        className={cn(
                          "flex items-center gap-2 rounded px-2 hover:bg-primary-1",
                          expanded && "bg-primary-1",
                        )}
                      >
                        <Checkbox
                          aria-label={path}
                          title={added ? t("addFeatureAlreadyAdded") : path}
                          checked={added || selected.has(node.id)}
                          disabled={added || !node.selectable}
                          onCheckedChange={() => toggle(node.id)}
                        />
                        <button
                          type="button"
                          title={path}
                          aria-expanded={hasChildren ? expanded : undefined}
                          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-[13px]"
                          onClick={() => {
                            setActivePath((current) => [...current.slice(0, depth), node.id]);
                            if (!hasChildren && node.selectable && !added) toggle(node.id);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{node.name}</span>
                          {hasChildren ? (
                            <ChevronRightIcon className="size-3.5 shrink-0 text-basic-5" />
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        {picks.length > 0 ? (
          <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
            {picks.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex max-w-full items-center gap-1 rounded border border-primary-3 bg-primary-1 px-2 py-1 text-xs text-primary-6"
              >
                <span className="truncate" title={tag.tagPath.join(" > ")}>
                  {tag.tagPath.join(" > ")}
                </span>
                <button
                  type="button"
                  aria-label={`${t("tooltipRemove")} ${tag.tagPath.join(" > ")}`}
                  onClick={() => toggle(tag.id)}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {t("rejectConfirmCancel")}
          </Button>
          <Button
            disabled={picks.length === 0}
            onClick={() => {
              onConfirm(picks);
              close(false);
            }}
          >
            {t("addFeatureConfirm", { count: picks.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
