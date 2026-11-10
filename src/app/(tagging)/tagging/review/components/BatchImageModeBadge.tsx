"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TaggingQueueItemExtra } from "@/prisma/client";
import { useTranslations } from "next-intl";

/** Read only the batch snapshot: current team settings cannot describe an older task. */
export function BatchImageModeBadge({ extra }: { extra: unknown }) {
  const t = useTranslations("Tagging.Review");
  const mode = (extra as TaggingQueueItemExtra | null)?.featureImageMode;
  const recorded = typeof mode === "boolean";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={`inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs leading-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-6 focus-visible:ring-offset-2 focus-visible:ring-offset-basic-1 ${
              mode === true
                ? "border border-primary-3 bg-primary-1 text-primary-6 dark:border-primary-6/40 dark:bg-primary-6/15 dark:text-primary-8"
                : "border border-basic-3 bg-basic-1 text-basic-8"
            }`}
          >
            {t(!recorded ? "batchImageModeUnknown" : mode ? "batchImageModeOn" : "batchImageModeOff")}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t(recorded ? "batchImageModeHint" : "batchImageModeUnknownHint")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
