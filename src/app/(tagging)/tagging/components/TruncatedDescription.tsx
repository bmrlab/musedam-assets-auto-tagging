"use client";

import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const TOOLTIP_MIN_WIDTH_PX = 280;
const TOOLTIP_MAX_WIDTH_PX = 480;
const TOOLTIP_MAX_HEIGHT_PX = 320;

export default function TruncatedDescription({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const updateTruncation = useCallback(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    setIsTruncated(element.scrollWidth > element.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    updateTruncation();

    const element = textRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(updateTruncation);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, updateTruncation]);

  const truncatedText = (
    <span
      ref={textRef}
      className={cn(
        "mt-1.5 block max-w-full truncate text-sm leading-[20px] text-basic-5",
        isTruncated ? "cursor-default" : null,
        className,
      )}
    >
      {text}
    </span>
  );

  if (!isTruncated) {
    return truncatedText;
  }

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{truncatedText}</TooltipPrimitive.Trigger>
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
              <p
                className="overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-basic-8"
                style={{ maxHeight: TOOLTIP_MAX_HEIGHT_PX }}
              >
                {text}
              </p>
            </div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
