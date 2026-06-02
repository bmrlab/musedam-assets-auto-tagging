"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

type LinkedTag = {
  id: string;
  tagPath: string[];
};

const tagPillClassName =
  "inline-flex items-center rounded-[4px] border border-basic-4 bg-background px-[6px] py-[3px] text-[12px] font-normal leading-[16px] text-basic-8";

export default function LinkedTagsOverflow({
  tags,
  emptyText,
  maxVisibleTags = 2,
}: {
  tags: LinkedTag[];
  emptyText: string;
  maxVisibleTags?: number;
}) {
  if (tags.length === 0) {
    return <span className="text-sm text-basic-5">{emptyText}</span>;
  }

  const visibleTags = tags.slice(0, maxVisibleTags);
  const hiddenTags = tags.slice(maxVisibleTags);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visibleTags.map((tag) => (
        <span key={tag.id} className={tagPillClassName}>
          {tag.tagPath.join(" > ")}
        </span>
      ))}
      {hiddenTags.length > 0 ? (
        <TooltipPrimitive.Provider delayDuration={200}>
          <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>
              <span className={cn(tagPillClassName, "cursor-default")}>+{hiddenTags.length}</span>
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content
                side="top"
                align="start"
                sideOffset={8}
                className="z-50 w-fit max-w-[420px] origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
              >
                <div className="w-fit max-w-[420px] rounded-[8px] border border-basic-3 bg-background p-2 shadow-[var(--ant-box-shadow)]">
                  <div className="flex flex-col items-start gap-1.5">
                    {hiddenTags.map((tag) => (
                      <span key={tag.id} className={cn(tagPillClassName, "w-fit max-w-full")}>
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
  );
}
