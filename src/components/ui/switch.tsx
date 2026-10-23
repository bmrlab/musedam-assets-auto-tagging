"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "default" | "sm" }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "active:blur-2xl",
        "peer data-[state=checked]:bg-primary-6 data-[state=unchecked]:bg-basic-4 focus-visible:border-ring focus-visible:ring-ring/50  inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-4 w-7" : "h-[22px] w-[44px]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "shadow-[0px_2px_4px_0px_#00230B33]",
          "bg-white pointer-events-none block rounded-full ring-0 transition-transform",
          size === "sm"
            ? "size-3 data-[state=checked]:translate-x-[13px] data-[state=unchecked]:translate-x-[1px]"
            : "size-[18px] data-[state=checked]:translate-x-[calc(100%+4px)] data-[state=unchecked]:translate-x-[2px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
