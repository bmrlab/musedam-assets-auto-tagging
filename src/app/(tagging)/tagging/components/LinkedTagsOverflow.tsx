"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";

type LinkedTag = {
  id: string;
  tagPath: string[];
};

const TAG_GAP_PX = 8;
const TOOLTIP_MIN_WIDTH_PX = 280;
const TOOLTIP_MAX_WIDTH_PX = 480;
/** Small buffer so pills never clip before the +n badge appears. */
const WIDTH_FUDGE_PX = 4;

const tagPillClassName =
  "inline-flex items-center rounded-[4px] border border-basic-4 bg-background px-[6px] py-[3px] text-[12px] font-normal leading-[16px] text-basic-8";

function getVisibleTagCount({
  tagWidths,
  maxContentWidth,
  measureBadgeWidth,
}: {
  tagWidths: number[];
  maxContentWidth: number;
  measureBadgeWidth: (hiddenCount: number) => number;
}) {
  const tagCount = tagWidths.length;
  const availableWidth = maxContentWidth - WIDTH_FUDGE_PX;
  if (tagCount === 0 || availableWidth <= 0) {
    return 0;
  }

  const rowWidth = (visibleCount: number) => {
    let width = 0;
    for (let index = 0; index < visibleCount; index += 1) {
      if (index > 0) {
        width += TAG_GAP_PX;
      }
      width += tagWidths[index] ?? 0;
    }

    const hiddenCount = tagCount - visibleCount;
    if (hiddenCount > 0) {
      width += TAG_GAP_PX + measureBadgeWidth(hiddenCount);
    }

    return width;
  };

  for (let visibleCount = tagCount; visibleCount >= 1; visibleCount -= 1) {
    if (rowWidth(visibleCount) <= availableWidth) {
      return visibleCount;
    }
  }

  return 1;
}

function getFirstTagLayout({
  tagWidth,
  availableWidth,
  hiddenCount,
  measureBadgeWidth,
}: {
  tagWidth: number;
  availableWidth: number;
  hiddenCount: number;
  measureBadgeWidth: (hiddenCount: number) => number;
}) {
  const badgeSpace = hiddenCount > 0 ? TAG_GAP_PX + measureBadgeWidth(hiddenCount) : 0;
  const maxTagWidth = availableWidth - badgeSpace;

  if (tagWidth <= maxTagWidth) {
    return { truncate: false, maxWidth: undefined };
  }

  return {
    truncate: true,
    maxWidth: Math.max(0, maxTagWidth),
  };
}

function TagPill({
  tag,
  truncate,
  maxWidth,
}: {
  tag: LinkedTag;
  truncate?: boolean;
  maxWidth?: number;
}) {
  const text = tag.tagPath.join(" > ");
  const pill = (
    <span
      className={cn(
        tagPillClassName,
        truncate ? "inline-block min-w-0 shrink max-w-full cursor-default truncate" : "shrink-0",
      )}
      style={truncate && maxWidth != null ? { maxWidth } : undefined}
    >
      {text}
    </span>
  );

  if (!truncate) {
    return pill;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="rounded-[4px]">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default function LinkedTagsOverflow({
  tags,
  emptyText,
}: {
  tags: LinkedTag[];
  emptyText: string;
}) {
  const t = useTranslations("Tagging.Common");
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const badgeMeasureRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(1);
  const [truncateFirstTag, setTruncateFirstTag] = useState(false);
  const [firstTagMaxWidth, setFirstTagMaxWidth] = useState<number | undefined>();
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    const badgeMeasure = badgeMeasureRef.current;
    if (!measure || !badgeMeasure || containerWidth <= 0) {
      return;
    }

    const tagElements = measure.querySelectorAll<HTMLElement>("[data-tag-measure]");
    const tagWidths = Array.from(tagElements).map((element) => element.offsetWidth);
    const availableWidth = containerWidth - WIDTH_FUDGE_PX;

    const measureBadgeWidth = (hiddenCount: number) => {
      badgeMeasure.textContent = `+${hiddenCount}`;
      return badgeMeasure.offsetWidth;
    };

    const nextVisibleCount = getVisibleTagCount({
      tagWidths,
      maxContentWidth: containerWidth,
      measureBadgeWidth,
    });
    const hiddenCount = tags.length - nextVisibleCount;

    let nextTruncateFirstTag = false;
    let nextFirstTagMaxWidth: number | undefined;

    if (nextVisibleCount === 1) {
      const layout = getFirstTagLayout({
        tagWidth: tagWidths[0] ?? 0,
        availableWidth,
        hiddenCount,
        measureBadgeWidth,
      });
      nextTruncateFirstTag = layout.truncate;
      nextFirstTagMaxWidth = layout.maxWidth;
    }

    setVisibleCount((current) => (current === nextVisibleCount ? current : nextVisibleCount));
    setTruncateFirstTag((current) =>
      current === nextTruncateFirstTag ? current : nextTruncateFirstTag,
    );
    setFirstTagMaxWidth((current) =>
      current === nextFirstTagMaxWidth ? current : nextFirstTagMaxWidth,
    );
  }, [tags, containerWidth]);

  if (tags.length === 0) {
    return <span className="text-sm text-basic-5">{emptyText}</span>;
  }

  const visibleTags = tags.slice(0, visibleCount);
  const hiddenCount = tags.length - visibleCount;

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden">
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex w-full max-w-full flex-nowrap items-center gap-2"
      >
        {tags.map((tag) => (
          <span key={tag.id} data-tag-measure className={cn(tagPillClassName, "shrink-0")}>
            {tag.tagPath.join(" > ")}
          </span>
        ))}
        <span ref={badgeMeasureRef} className={cn(tagPillClassName, "shrink-0")}>
          +0
        </span>
      </div>

      <div className="flex max-w-full flex-nowrap items-center gap-2">
        {visibleTags.map((tag, index) => (
          <TagPill
            key={tag.id}
            tag={tag}
            truncate={index === 0 && truncateFirstTag}
            maxWidth={firstTagMaxWidth}
          />
        ))}
        {hiddenCount > 0 ? (
          <TooltipPrimitive.Provider delayDuration={200}>
            <TooltipPrimitive.Root>
              <TooltipPrimitive.Trigger asChild>
                <span className={cn(tagPillClassName, "shrink-0 cursor-default")}>
                  +{hiddenCount}
                </span>
              </TooltipPrimitive.Trigger>
              <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="z-50 origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
                  style={{
                    width: "max-content",
                    minWidth: `min(${TOOLTIP_MIN_WIDTH_PX}px, calc(100vw - 32px))`,
                    maxWidth: `min(${TOOLTIP_MAX_WIDTH_PX}px, calc(100vw - 32px))`,
                  }}
                >
                  <div className="rounded-[8px] border border-basic-3 bg-background px-3 py-2 shadow-[var(--ant-box-shadow)]">
                    <div className="mb-2 text-[11px] leading-4 font-semibold text-basic-5">
                      {t("allLinkedTagsTitle", { count: tags.length })}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {tags.map((tag) => (
                        <span key={tag.id} className={cn(tagPillClassName, "max-w-full")}>
                          {tag.tagPath.join(" > ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </TooltipPrimitive.Content>
              </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
          </TooltipPrimitive.Provider>
        ) : null}
      </div>
    </div>
  );
}
