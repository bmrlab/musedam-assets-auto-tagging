"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface CheckboxProps extends React.ComponentProps<typeof CheckboxPrimitive.Root> {
  indeterminate?: boolean;
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, indeterminate, checked, ...props }, ref) => {
  // 当 indeterminate 为 true 时，使用 'indeterminate' 作为 checked 值
  const effectiveChecked = indeterminate ? 'indeterminate' : checked;

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-slot="checkbox"
      checked={effectiveChecked}
      className={cn(
        "cursor-pointer ease-in-out transition-all duration-300 hover:border-primary-6",
        "peer border-input data-[state=checked]:bg-primary-6 data-[state=checked]:border-primary-6 data-[state=checked]:text-white focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        // indeterminate && "bg-primary-6 text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {indeterminate ? (
          <div className="size-[10px] rounded-[2px] bg-primary-6" />
        ) : (
          <CheckIcon className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

Checkbox.displayName = "Checkbox";

export { Checkbox };
