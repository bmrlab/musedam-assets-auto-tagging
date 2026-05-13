"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { detectBrandLogoBoxes } from "@/lib/brand/logo-classification";
import { buildAssetLogoObjectKey, getCachedSignedOssObjectUrl, uploadOssObject } from "@/lib/oss";
import { ServerActionResult } from "@/lib/serverAction";
import { DetectionUploadResult } from "./types";

function isImageFile(file: File) {
  return file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg");
}

function getFileExtension(file: File) {
  const match = file.name.match(/\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (file.type === "image/png") return ".png";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/svg+xml") return ".svg";
  if (file.type === "image/gif") return ".gif";
  return "";
}

function getDetectionLabelText(formData: FormData) {
  const value = formData.get("detection_label_text");
  return typeof value === "string" ? value.trim() : "";
}

export async function detectLogoBoxesAction(
  formData: FormData,
): Promise<ServerActionResult<DetectionUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      if (!isDebugPageEnabled()) {
        return {
          success: false,
          message: "Detection debug page is disabled.",
          code: "forbidden",
        };
      }

      const detectionLabelText = getDetectionLabelText(formData);
      if (!detectionLabelText) {
        return {
          success: false,
          message: "Enter detection label text before running detection.",
        };
      }

      const image = formData.get("image");
      if (!(image instanceof File) || image.size <= 0) {
        return {
          success: false,
          message: "Upload an image before running detection.",
        };
      }

      if (!isImageFile(image)) {
        return {
          success: false,
          message: "Only image files are supported.",
        };
      }

      const objectKey = buildAssetLogoObjectKey({
        teamId,
        extension: getFileExtension(image),
      });
      const buffer = Buffer.from(await image.arrayBuffer());
      await uploadOssObject({
        body: buffer,
        contentType: image.type || "application/octet-stream",
        objectKey,
      });

      const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
        objectKey,
        expiresInSeconds: 60 * 60,
      });
      const detection = await detectBrandLogoBoxes({
        teamId,
        imageUrl: signedUrl,
        detectionLabelText,
      });

      return {
        success: true,
        data: {
          objectKey,
          signedUrl,
          signedUrlExpiresAt,
          detections: detection.detections,
          found: detection.found,
          detectionLabelText,
        },
      };
    } catch (error) {
      console.error("Failed to run logo detection debug action:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Detection failed.",
      };
    }
  });
}
