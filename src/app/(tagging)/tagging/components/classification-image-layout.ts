import type { CSSProperties } from "react";

export type ClassificationImageMeta = {
  width: number;
  height: number;
};

export type ClassificationBoxCoordinates = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

const MAX_PREVIEW_HEIGHT = 720;

export function clampClassificationBox<T extends ClassificationBoxCoordinates>(
  box: T,
  meta: ClassificationImageMeta,
): T {
  const xMin = Math.max(0, Math.min(meta.width, box.xMin));
  const yMin = Math.max(0, Math.min(meta.height, box.yMin));
  const xMax = Math.max(xMin + 1, Math.min(meta.width, box.xMax));
  const yMax = Math.max(yMin + 1, Math.min(meta.height, box.yMax));

  return {
    ...box,
    xMin,
    yMin,
    xMax,
    yMax,
  };
}

export function getClassificationBoxPercentages(
  box: ClassificationBoxCoordinates,
  meta: ClassificationImageMeta,
) {
  return {
    left: (box.xMin / meta.width) * 100,
    top: (box.yMin / meta.height) * 100,
    width: ((box.xMax - box.xMin) / meta.width) * 100,
    height: ((box.yMax - box.yMin) / meta.height) * 100,
  };
}

export function getClassificationLabelPosition(
  box: ClassificationBoxCoordinates,
  meta: ClassificationImageMeta,
  maxWidth = 280,
) {
  const left = (box.xMin / meta.width) * 100;
  const top = (box.yMin / meta.height) * 100;
  const bottom = (box.yMax / meta.height) * 100;
  const placeBelow = top < 10;

  return {
    left: `min(calc(${left}% + 8px), calc(100% - 12px))`,
    top: placeBelow ? `calc(${bottom}% + 8px)` : `calc(${top}% - 8px)`,
    transform: placeBelow ? "translateY(0)" : "translateY(-100%)",
    maxWidth: `min(${maxWidth}px, calc(100% - ${left}% - 12px))`,
  };
}

export function getClassificationImageFrameStyle(meta: ClassificationImageMeta): CSSProperties {
  const widthAtMaxHeight = (MAX_PREVIEW_HEIGHT * meta.width) / meta.height;

  return {
    width: `${Math.min(meta.width, widthAtMaxHeight)}px`,
    maxWidth: "100%",
    aspectRatio: `${meta.width} / ${meta.height}`,
  };
}
