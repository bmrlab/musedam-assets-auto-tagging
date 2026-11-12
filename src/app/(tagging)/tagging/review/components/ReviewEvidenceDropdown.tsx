"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileSearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function ReviewEvidenceDropdown({ name, children }: { name: string; children: ReactNode }) {
  const t = useTranslations("Tagging.Metadata");
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${t("evidence")} ${name}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-6 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <FileSearchIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-md border-basic-3 bg-basic-0 p-4 text-[13px] leading-[22px] text-basic-8 dark:border-basic-4 dark:text-basic-9"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] leading-[18px] text-basic-5 dark:text-basic-6">{t("evidence")}</span>
          <span className="break-words text-[13px] font-semibold leading-[18px]">{name}</span>
        </div>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
