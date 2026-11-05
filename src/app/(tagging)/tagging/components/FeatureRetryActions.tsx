"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, RotateCcw } from "lucide-react";

export default function FeatureRetryActions({
  retryLabel,
  retryAllLabel,
  onRetry,
  onRetryAll,
  disabled,
}: {
  retryLabel: string;
  retryAllLabel: string;
  onRetry: () => void;
  onRetryAll: () => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={onRetry}
        className="inline-flex h-[22px] cursor-pointer items-center whitespace-nowrap rounded-[4px] text-[12px] leading-[16px] font-normal text-primary-6 transition-colors hover:text-primary-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-5 disabled:cursor-not-allowed disabled:text-basic-5"
      >
        {retryLabel}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={retryAllLabel}
            className="inline-flex h-[22px] w-5 cursor-pointer items-center justify-center rounded-[4px] text-primary-6 transition-colors hover:bg-primary-1 hover:text-primary-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-5 disabled:cursor-not-allowed disabled:text-basic-5 data-[state=open]:bg-primary-1"
          >
            <ChevronDown aria-hidden="true" className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-max min-w-0 rounded-[4px] border border-basic-3 p-1"
        >
          <DropdownMenuItem
            disabled={disabled}
            onSelect={onRetryAll}
            className="gap-1.5 whitespace-nowrap px-2 py-1 text-[12px] font-normal leading-[16px] text-basic-8"
          >
            <RotateCcw aria-hidden="true" className="size-3" />
            {retryAllLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
