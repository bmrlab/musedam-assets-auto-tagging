import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const tagVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[4px] text-xs font-medium transition-all duration-200",
  {
    variants: {
      variant: {
        default: "bg-primary-1 text-primary-6 border border-primary-3",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-border bg-background text-foreground",
        destructive: "bg-destructive/10 text-destructive border border-destructive/20",
        success: "bg-green-50 text-green-700 border border-green-200",
        warning: "bg-yellow-50 text-yellow-700 border border-yellow-200",
        info: "bg-blue-50 text-blue-700 border border-blue-200",
        purple: "bg-[#F9F0FF] text-[#722ED1] border border-[#D3ADF7]",
      },
      size: {
        sm: "px-2 py-1 text-xs",
        default: "px-[6px] py-[2px]",
        lg: "px-3 py-2 text-sm",
      },
      shape: {
        rounded: "rounded-[4px]",
        pill: "rounded-full",
        square: "rounded-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "rounded",
    },
  },
);

export interface TagProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof tagVariants> {
  children: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  removeIcon?: React.ReactNode;
}

function Tag({
  className,
  variant,
  size,
  shape,
  children,
  removable = false,
  onRemove,
  removeIcon,
  ...props
}: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(tagVariants({ variant, size, shape, className }))}
      {...props}
    >
      {children}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 hover:opacity-70 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current rounded-sm"
          aria-label="移除标签"
        >
          {removeIcon || (
            <svg
              className="size-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

// TagGroup 组件用于管理多个标签
export interface TagGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  spacing?: "sm" | "default" | "lg";
  wrap?: boolean;
}

function TagGroup({
  className,
  children,
  spacing = "default",
  wrap = true,
  ...props
}: TagGroupProps) {
  const spacingClasses = {
    sm: "gap-1",
    default: "gap-2",
    lg: "gap-3",
  };

  return (
    <div
      data-slot="tag-group"
      className={cn(
        "flex items-center",
        wrap ? "flex-wrap" : "flex-nowrap",
        spacingClasses[spacing],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Tag, TagGroup, tagVariants };
