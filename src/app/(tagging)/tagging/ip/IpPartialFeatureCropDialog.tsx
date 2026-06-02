/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
  IP_PARTIAL_MATCH_PATTERN_OPTIONS,
  IpPartialMatchPatternName,
} from "@/lib/ip/match-pattern";
import { cn } from "@/lib/utils";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IpDetectionBox } from "./types";

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

export type PartialFeatureCropSelection = {
  partialMatchPatternName: IpPartialMatchPatternName;
  cropXMin: number;
  cropYMin: number;
  cropXMax: number;
  cropYMax: number;
  cropImageWidth: number;
  cropImageHeight: number;
  cropSource: "algorithm" | "manual";
  cropDetectionLabel: string | null;
  cropDetectionScore: number | null;
};

export type PartialFeatureCropDialogImage = {
  id: string;
  name: string;
  previewUrl: string;
  partialMatchPatternName: IpPartialMatchPatternName;
  imageWidth: number;
  imageHeight: number;
  detections: IpDetectionBox[];
};

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

type DragState = {
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  startBox: IpDetectionBox;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getFallbackBox(image: PartialFeatureCropDialogImage): IpDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: image.imageWidth,
    yMax: image.imageHeight,
    score: 1,
    label: image.partialMatchPatternName,
  };
}

function normalizeBox(box: IpDetectionBox, image: PartialFeatureCropDialogImage): IpDetectionBox {
  const minSize = Math.max(12, Math.min(image.imageWidth, image.imageHeight) * 0.04);
  const xMin = clamp(box.xMin, 0, image.imageWidth - minSize);
  const yMin = clamp(box.yMin, 0, image.imageHeight - minSize);
  const xMax = clamp(box.xMax, xMin + minSize, image.imageWidth);
  const yMax = clamp(box.yMax, yMin + minSize, image.imageHeight);

  return {
    ...box,
    xMin,
    yMin,
    xMax,
    yMax,
  };
}

function pickRecommendation(image: PartialFeatureCropDialogImage | null) {
  if (!image) {
    return null;
  }

  return normalizeBox(
    image.detections.slice().sort((left, right) => right.score - left.score)[0] ??
      getFallbackBox(image),
    image,
  );
}

export default function IpPartialFeatureCropDialog({
  image,
  open,
  detecting,
  t,
  onOpenChange,
  onFeatureChange,
  onConfirm,
}: {
  image: PartialFeatureCropDialogImage | null;
  open: boolean;
  detecting: boolean;
  t: TranslationFunction;
  onOpenChange: (open: boolean) => void;
  onFeatureChange: (featureName: IpPartialMatchPatternName) => void;
  onConfirm: (selection: PartialFeatureCropSelection) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [box, setBox] = useState<IpDetectionBox | null>(null);
  const [source, setSource] = useState<"algorithm" | "manual">("algorithm");
  const [dragState, setDragState] = useState<DragState | null>(null);

  const recommendation = useMemo(() => pickRecommendation(image), [image]);

  useEffect(() => {
    setBox(recommendation);
    setSource("algorithm");
  }, [recommendation]);

  useEffect(() => {
    const activeDragState = dragState;
    const activeImage = image;

    if (!activeDragState || !activeImage) {
      return;
    }

    const safeDragState: DragState = activeDragState;
    const safeImage: PartialFeatureCropDialogImage = activeImage;

    function handlePointerMove(event: PointerEvent) {
      const rect = imageRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const deltaX =
        ((event.clientX - safeDragState.startClientX) / rect.width) * safeImage.imageWidth;
      const deltaY =
        ((event.clientY - safeDragState.startClientY) / rect.height) * safeImage.imageHeight;
      const start = safeDragState.startBox;
      const minSize = Math.max(12, Math.min(safeImage.imageWidth, safeImage.imageHeight) * 0.04);
      let nextBox: IpDetectionBox = { ...start };

      if (safeDragState.mode === "move") {
        const width = start.xMax - start.xMin;
        const height = start.yMax - start.yMin;
        const xMin = clamp(start.xMin + deltaX, 0, safeImage.imageWidth - width);
        const yMin = clamp(start.yMin + deltaY, 0, safeImage.imageHeight - height);
        nextBox = {
          ...start,
          xMin,
          yMin,
          xMax: xMin + width,
          yMax: yMin + height,
        };
      } else {
        const left = safeDragState.mode.includes("w")
          ? clamp(start.xMin + deltaX, 0, start.xMax - minSize)
          : start.xMin;
        const right = safeDragState.mode.includes("e")
          ? clamp(start.xMax + deltaX, start.xMin + minSize, safeImage.imageWidth)
          : start.xMax;
        const top = safeDragState.mode.includes("n")
          ? clamp(start.yMin + deltaY, 0, start.yMax - minSize)
          : start.yMin;
        const bottom = safeDragState.mode.includes("s")
          ? clamp(start.yMax + deltaY, start.yMin + minSize, safeImage.imageHeight)
          : start.yMax;

        nextBox = {
          ...start,
          xMin: left,
          yMin: top,
          xMax: right,
          yMax: bottom,
        };
      }

      setBox(normalizeBox(nextBox, safeImage));
      setSource("manual");
    }

    function handlePointerUp() {
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, image]);

  const boxStyle = (() => {
    if (!image || !box) {
      return null;
    }

    const left = (box.xMin / image.imageWidth) * 100;
    const top = (box.yMin / image.imageHeight) * 100;
    const width = ((box.xMax - box.xMin) / image.imageWidth) * 100;
    const height = ((box.yMax - box.yMin) / image.imageHeight) * 100;

    return { left, top, width, height };
  })();

  function handleResetRecommendation() {
    setBox(recommendation);
    setSource("algorithm");
  }

  function startDrag(mode: DragMode, event: React.PointerEvent) {
    if (!box) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDragState({
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBox: box,
    });
  }

  function handleConfirm() {
    if (!image || !box) {
      return;
    }

    const normalizedBox = normalizeBox(box, image);
    onConfirm({
      partialMatchPatternName: image.partialMatchPatternName,
      cropXMin: normalizedBox.xMin,
      cropYMin: normalizedBox.yMin,
      cropXMax: normalizedBox.xMax,
      cropYMax: normalizedBox.yMax,
      cropImageWidth: image.imageWidth,
      cropImageHeight: image.imageHeight,
      cropSource: source,
      cropDetectionLabel: normalizedBox.label || null,
      cropDetectionScore: Number.isFinite(normalizedBox.score) ? normalizedBox.score : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] w-[680px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[16px] shadow-lg p-0">
        <DialogHeader className="h-14 justify-center gap-0 px-5 py-4">
          <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
            {t("dialog.cropTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 px-5 pt-0 pb-3">
          <div className="rounded-[8px] border border-primary-5 bg-primary-1 px-4 py-3 text-[12px] font-normal leading-[18px] text-basic-6">
            💡 {t("dialog.cropInstruction")}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.partialFeatureLabel")}
              </span>
              <Select
                value={image?.partialMatchPatternName ?? DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME}
                onValueChange={(value) => onFeatureChange(value as IpPartialMatchPatternName)}
                disabled={!image || detecting}
              >
                <SelectTrigger className="h-8 w-[160px] rounded-[6px] border border-basic-4 px-3 py-0 text-[14px] leading-[22px] font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IP_PARTIAL_MATCH_PATTERN_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`dialog.partialOptions.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {detecting ? (
                <span className="inline-flex items-center gap-1 text-[12px] leading-[16px] font-normal text-basic-5">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("dialog.detectingRecommendation")}
                </span>
              ) : null}
            </div>

            <Button
              type="button"
              variant="ghost"
              onClick={handleResetRecommendation}
              disabled={!recommendation || detecting}
              className="h-8 gap-2 px-3 text-[14px] leading-[22px] font-normal text-basic-8"
            >
              <RotateCcw className="size-4" />
              {t("dialog.resetRecommendation")}
            </Button>
          </div>

          <div className="flex justify-center overflow-auto rounded-[8px] bg-basic-1 p-0">
            {image ? (
              <div className="pb-0.5 pt-5">
                <div className="relative inline-block max-h-[62vh] max-w-full select-none bg-[#EEF3FB]">
                  <img
                    ref={imageRef}
                    src={image.previewUrl}
                    alt={image.name}
                    className="block max-h-[62vh] max-w-full"
                    draggable={false}
                  />
                  {boxStyle ? (
                    <div className="absolute inset-0">
                      <div
                        className="absolute left-0 right-0 top-0 bg-black/60"
                        style={{ height: `${boxStyle.top}%` }}
                      />
                      <div
                        className="absolute left-0 bg-black/60"
                        style={{
                          top: `${boxStyle.top}%`,
                          width: `${boxStyle.left}%`,
                          height: `${boxStyle.height}%`,
                        }}
                      />
                      <div
                        className="absolute right-0 bg-black/60"
                        style={{
                          top: `${boxStyle.top}%`,
                          left: `${boxStyle.left + boxStyle.width}%`,
                          height: `${boxStyle.height}%`,
                        }}
                      />
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-black/60"
                        style={{ top: `${boxStyle.top + boxStyle.height}%` }}
                      />

                      <div
                        role="presentation"
                        className={cn(
                          "absolute cursor-move border-2",
                          source === "manual"
                            ? "border-[#00B887] shadow-[0_0_0_1px_rgba(0,184,135,0.24)]"
                            : "border-primary-6 shadow-[0_0_0_1px_rgba(51,102,255,0.24)]",
                        )}
                        style={{
                          left: `${boxStyle.left}%`,
                          top: `${boxStyle.top}%`,
                          width: `${boxStyle.width}%`,
                          height: `${boxStyle.height}%`,
                        }}
                        onPointerDown={(event) => startDrag("move", event)}
                      >
                        <span
                          className={cn(
                            "absolute left-1 top-0 -translate-y-full rounded-t-[4px] px-2 py-1 text-[12px] leading-4 font-semibold text-white",
                            source === "manual" ? "bg-[#00B887]" : "bg-primary-6",
                          )}
                        >
                          {source === "manual"
                            ? t("dialog.manualAdjusted")
                            : t("dialog.algorithmRecommended")}
                        </span>
                        {(["nw", "ne", "sw", "se"] as DragMode[]).map((mode) => (
                          <span
                            key={mode}
                            role="presentation"
                            className={cn(
                              "absolute h-3 w-3 rounded-[2px] border-2 bg-white",
                              source === "manual" ? "border-[#00B887]" : "border-primary-6",
                              mode === "nw" &&
                                "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
                              mode === "ne" &&
                                "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
                              mode === "sw" &&
                                "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
                              mode === "se" &&
                                "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
                            )}
                            onPointerDown={(event) => startDrag(mode, event)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </div>

        <DialogFooter className="min-h-16 gap-[10px] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 w-20 rounded-[6px] border border-basic-4 px-3 py-1"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!image || !box || detecting}
            className="h-8 min-w-20 rounded-[6px] border border-basic-4 px-3 py-1"
          >
            {t("dialog.confirmAndSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
