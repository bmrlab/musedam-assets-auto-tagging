"use client";

import { cn } from "@/lib/utils";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ReactNode, useEffect, useState } from "react";
import SignedIpImage from "./SignedIpImage";
import { IpImageItem } from "./types";

type IpImageHoverCardProps = {
  image: IpImageItem;
  alt: string;
  children: ReactNode;
  className?: string;
};

export default function IpImageHoverCard({
  image,
  alt,
  children,
  className,
}: IpImageHoverCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(100);

  useEffect(() => {
    setIsLoaded(false);
    setPreviewWidth(100);
  }, [image.id]);

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
              <div
                className="relative h-[100px] overflow-hidden rounded-[14px] bg-[#f7f9fc]"
                style={{ width: `${previewWidth}px` }}
              >
                {!isLoaded ? (
                  <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-r from-[#EDF1F7] via-[#F7F9FC] to-[#EDF1F7]" />
                ) : null}
                <SignedIpImage
                  imageId={image.id}
                  signedUrl={image.signedUrl}
                  signedUrlExpiresAt={image.signedUrlExpiresAt}
                  alt={alt}
                  className={cn(
                    "block h-full w-full object-contain transition-opacity duration-200",
                    isLoaded ? "opacity-100" : "opacity-0",
                  )}
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    if (naturalWidth > 0 && naturalHeight > 0) {
                      const widthByRatio = Math.round((naturalWidth / naturalHeight) * 100);
                      setPreviewWidth(Math.max(80, Math.min(320, widthByRatio)));
                    }
                    setIsLoaded(true);
                  }}
                  onError={() => setIsLoaded(true)}
                />
              </div>
            </div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
