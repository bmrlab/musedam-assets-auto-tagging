import "server-only";

import { bufferToDataUrl } from "@/lib/brand/image";
import type {
  ClassificationDetectionBox,
  ClassificationRemoteImageInput,
} from "@/lib/tagging/classification-image";
import { prepareSquareEmbeddingImageBuffer } from "@/lib/tagging/reference-image";

/** Detector boxes stay in preview coordinates; only the extraction uses source coordinates. */
export async function cropProductImageToDataUrl({
  imageInput,
  box,
}: {
  imageInput: ClassificationRemoteImageInput;
  box: Pick<ClassificationDetectionBox, "xMin" | "yMin" | "xMax" | "yMax">;
}): Promise<string> {
  const source = imageInput.original ?? imageInput;
  if (
    ![imageInput.width, imageInput.height, source.width, source.height].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    ![box.xMin, box.yMin, box.xMax, box.yMax].every(Number.isFinite)
  ) {
    throw new Error("Invalid product crop dimensions");
  }

  // Use each actual preview dimension to account for rounding during preview resizing.
  const scaleX = source.width / imageInput.width;
  const scaleY = source.height / imageInput.height;
  const left = Math.max(0, Math.floor(box.xMin * scaleX));
  const top = Math.max(0, Math.floor(box.yMin * scaleY));
  const right = Math.min(source.width, Math.ceil(box.xMax * scaleX));
  const bottom = Math.min(source.height, Math.ceil(box.yMax * scaleY));
  if (right <= left || bottom <= top) {
    throw new Error("Product crop is outside the source image");
  }

  // Extract before resizing; lossless PNG avoids an extra JPEG pass before embedding.
  const buffer = await prepareSquareEmbeddingImageBuffer(source.buffer, {
    left,
    top,
    width: right - left,
    height: bottom - top,
  });
  return bufferToDataUrl(buffer, "image/png");
}
