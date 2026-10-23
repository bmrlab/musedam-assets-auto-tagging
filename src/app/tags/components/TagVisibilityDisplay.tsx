"use client";

import { DepartmentIcon, TeamIcon } from "@/components/ui";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getTagVisibilityPreview } from "../tagVisibility";

export type VisibilitySelection = {
  members: Array<{
    id: unknown;
    name: string;
    avatarUrl?: string;
    departmentsName?: string;
  }>;
  departments: Array<{ id: unknown; name: string }>;
  groups: Array<{ id: unknown; name: string }>;
};

type VisibilityItem = {
  id: unknown;
  name: string;
  avatarUrl?: string;
  kind: "member" | "department" | "group";
};

type Props = {
  label: string;
  allMembersVisibleText: string;
  selection: VisibilitySelection;
  loading: boolean;
  onSelect: () => void;
  readOnly?: boolean;
};

const getVisibilityItems = (selection: VisibilitySelection): VisibilityItem[] => [
  ...selection.members.map((item) => ({ ...item, kind: "member" as const })),
  ...selection.departments.map((item) => ({ ...item, kind: "department" as const })),
  ...selection.groups.map((item) => ({ ...item, kind: "group" as const })),
];

const VisibilityAvatar = ({ item, size = "md" }: { item: VisibilityItem; size?: "sm" | "md" }) => {
  const sizeClass = size === "sm" ? "size-6 text-[11px]" : "size-7 text-xs";
  const iconClass = size === "sm" ? "size-3" : "size-3.5";
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [item.avatarUrl]);

  if (item.kind === "member" && item.avatarUrl && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.avatarUrl}
        alt={item.name}
        // 头像 OSS 开启了 Referer 防盗链，iframe 内带本站 Referer 会被拒绝
        referrerPolicy="no-referrer"
        className={cn(sizeClass, "shrink-0 rounded-full border-2 border-background bg-basic-2 object-cover")}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        sizeClass,
        "flex shrink-0 items-center justify-center rounded-full border-2 border-background font-medium text-white",
        item.kind === "group" ? "bg-primary-6" : "bg-[#C5CEE0]",
      )}
    >
      {item.kind === "department" ? (
        <DepartmentIcon className={iconClass} />
      ) : item.kind === "group" ? (
        <TeamIcon className={iconClass} />
      ) : (
        item.name.trim().slice(0, 1).toUpperCase()
      )}
    </span>
  );
};

export function TagVisibilityDisplay({
  label,
  allMembersVisibleText,
  selection,
  loading,
  onSelect,
  readOnly = false,
}: Props) {
  const items = getVisibilityItems(selection);
  const { visibleItems, remainingCount } = getTagVisibilityPreview(items);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const showDropdown = () => {
    cancelClose();
    if (items.length) setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="group h-9 max-w-[172px] gap-1 px-0 hover:bg-transparent"
              onMouseEnter={showDropdown}
              onMouseLeave={scheduleClose}
              onClick={() => {
                setOpen(false);
                if (!readOnly) onSelect();
              }}
              disabled={loading}
              aria-label={label}
            >
              {items.length ? (
                <span className="flex items-center pl-2">
                  {visibleItems.map((item, index) => (
                    <span
                      key={`${item.kind}-${String(item.id)}`}
                      className={index === 0 ? "relative" : "relative -ml-2"}
                      style={{ zIndex: visibleItems.length - index }}
                    >
                      <VisibilityAvatar item={item} />
                    </span>
                  ))}
                  {remainingCount > 0 && (
                    <span className="relative -ml-2 flex size-7 items-center justify-center rounded-full border-2 border-background bg-[#FFE5D8] text-xs font-medium text-[#FF5C35]">
                      +{remainingCount}
                    </span>
                  )}
                </span>
              ) : (
                <span className="truncate text-basic-5">{allMembersVisibleText}</span>
              )}
              {!readOnly && <ChevronRight className="size-4 shrink-0 text-basic-5 transition-colors group-hover:text-primary-6" />}
            </Button>
          </DropdownMenuTrigger>
          {items.length > 0 && (
            <DropdownMenuContent
              align="end"
              side="bottom"
              sideOffset={4}
              className="max-h-[280px] w-[240px] overflow-y-auto p-2"
              onMouseEnter={showDropdown}
              onMouseLeave={scheduleClose}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {items.map((item) => (
                <DropdownMenuItem
                  key={`${item.kind}-${String(item.id)}`}
                  className="cursor-default gap-2.5 px-2 py-2 focus:bg-basic-2"
                  onSelect={(event) => event.preventDefault()}
                >
                  <VisibilityAvatar item={item} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-basic-8">{item.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>
    </div>
  );
}
