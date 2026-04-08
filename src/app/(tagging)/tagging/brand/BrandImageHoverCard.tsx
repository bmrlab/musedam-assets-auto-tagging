"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import SignedBrandImage from "./SignedBrandImage";
import { BrandLogoImageItem } from "./types";

type BrandImageHoverCardProps = {
  image: BrandLogoImageItem;
  alt: string;
  children: ReactNode;
  className?: string;
};

export default function BrandImageHoverCard({
  image,
  alt,
  children,
  className,
}: BrandImageHoverCardProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={60} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            align="center"
            sideOffset={18}
            avoidCollisions={false}
            collisionPadding={24}
            className={cn(
              "z-[70] origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
              className,
            )}
          >
            <div className="inline-flex overflow-hidden rounded-[18px] border border-white bg-white p-2 shadow-[0_20px_48px_rgba(15,23,42,0.18)]">
              <div className="overflow-hidden rounded-[14px] bg-[#f7f9fc]">
                <SignedBrandImage
                  imageId={image.id}
                  signedUrl={image.signedUrl}
                  signedUrlExpiresAt={image.signedUrlExpiresAt}
                  alt={alt}
                  className="block h-[100px] w-auto max-w-[320px]"
                />
              </div>
            </div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
