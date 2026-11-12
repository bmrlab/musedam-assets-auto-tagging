import { isVideoAssetExtension } from "@/lib/feature-library";

export const CLASSIFICATION_VIDEO_UPLOAD_LIMIT_MB = 200;
export const CLASSIFICATION_VIDEO_UPLOAD_LIMIT = CLASSIFICATION_VIDEO_UPLOAD_LIMIT_MB * 1024 ** 2;

export type ClassificationVideoSource =
  | { kind: "local"; objectKey: string }
  | { kind: "musedam"; assetId: string };

export function getVideoExtension(name: string, extension?: string) {
  const suffix = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const value = (extension?.trim() || suffix).toLowerCase().replace(/^\./, "");
  return isVideoAssetExtension(value) ? value : null;
}
