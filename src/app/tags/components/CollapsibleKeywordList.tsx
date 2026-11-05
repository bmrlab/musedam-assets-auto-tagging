"use client";

import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

const PREVIEW_COUNT = 12;

export function CollapsibleKeywordList({
  keywords,
  onRemove,
  children,
}: {
  keywords: string[];
  onRemove?: (index: number) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("TagsPage.TagDetails");
  const tItem = useTranslations("TagsPage.TagItem");
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const canCollapse = keywords.length > PREVIEW_COUNT;
  const visibleKeywords = expanded ? keywords : keywords.slice(0, PREVIEW_COUNT);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        id={listId}
        className="max-h-64 overflow-y-auto overscroll-contain scrollbar-thin"
      >
        <div className="flex flex-wrap gap-2">
          {visibleKeywords.map((keyword, index) => (
            <div
              key={index}
              className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-xs leading-4 text-foreground dark:bg-basic-3"
            >
              <span className="min-w-0 break-all">{keyword}</span>
              {onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-basic-5 hover:text-danger-6"
                  aria-label={`${tItem("delete")}: ${keyword}`}
                  onClick={() => onRemove(index)}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          ))}
          {keywords.length === 0 && !children && <span className="text-sm text-basic-5">-</span>}
        </div>
      </div>
      {canCollapse && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-8 self-start px-0 text-primary-6 hover:text-primary-5"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("collapseKeywords") : t("expandKeywords", { count: keywords.length })}
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      )}
      {children && (
        <div onFocusCapture={() => setExpanded(true)} onClickCapture={() => setExpanded(true)}>
          {children}
        </div>
      )}
    </div>
  );
}
