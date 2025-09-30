import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import * as React from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "./input";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-start", className)}
      {...props}
    />
  );
}

function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-2", className)}
      {...props}
    />
  );
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
  disabled?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">;

function PaginationLink({ className, isActive, size = "icon", ...props }: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: "outline",
          size,
        }),
        isActive && 'border-primary-5 text-primary-5',
        className,
      )}
      {...props}
    />
  );
}

function PaginationPrevious({
  className,
  previousText,
  ariaLabel,
  disabled,
  ...props
}: React.ComponentProps<typeof PaginationLink> & {
  previousText?: string;
  ariaLabel?: string;
}) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      size="default"
      className={cn(" flex items-center size-8", disabled && "pointer-events-none opacity-50 cursor-not-allowed", className)}
      {...props}
    >
      <ChevronLeftIcon />
    </PaginationLink>
  );
}


function PaginationNext({
  className,
  nextText,
  ariaLabel,
  disabled,
  ...props
}: React.ComponentProps<typeof PaginationLink> & {
  nextText?: string;
  ariaLabel?: string;
}) {
  return (
    <PaginationLink
      aria-label={ariaLabel}
      size="default"
      className={cn("gap-1 flex items-center size-8", disabled && "pointer-events-none opacity-50 cursor-not-allowed", className)}
      {...props}
    >
      <ChevronRightIcon />
    </PaginationLink>
  );
}

function PaginationEllipsis({
  className,
  morePagesText = "More pages",
  ...props
}: React.ComponentProps<"span"> & {
  morePagesText?: string;
}) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-8 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">{morePagesText}</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
