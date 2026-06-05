"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { detectBrandLogoBoxes } from "@/lib/brand/logo-classification";
import { MAX_CLIENT_IMAGE_UPLOAD_BYTES } from "@/lib/brand/upload-constants";
import {
  buildAssetLogoObjectKey,
  getCachedSignedS3ObjectUrl,
  signS3ObjectUploadUrl,
} from "@/lib/s3";
import { ServerActionResult } from "@/lib/serverAction";
import { z } from "zod";
import { DetectionImageUploadResult, DetectionUploadResult } from "./types";

function getFileExtensionFromNameOrContentType({
  name,
  contentType,
}: {
  name: string;
  contentType: string;
}) {
  const match = name.match(/\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/svg+xml") return ".svg";
  if (contentType === "image/gif") return ".gif";
  return "";
}

function isTeamLogoObjectKey(objectKey: string, teamId: number) {
  return objectKey.startsWith(`auto-tagging/teams-${teamId}-asset-logos-`);
}

export async function prepareDetectionImageUploadAction(input: {
  name: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<DetectionImageUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      if (!isDebugPageEnabled()) {
        return {
          success: false,
          message: "Detection debug page is disabled.",
          code: "forbidden",
        };
      }

      const metadata = z
        .object({
          name: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1).max(255),
          size: z.number().int().positive().max(MAX_CLIENT_IMAGE_UPLOAD_BYTES),
        })
        .parse(input);

      if (
        !metadata.mimeType.startsWith("image/") &&
        !metadata.name.toLowerCase().endsWith(".svg")
      ) {
        return {
          success: false,
          message: "Only image files are supported.",
        };
      }

      const objectKey = buildAssetLogoObjectKey({
        teamId,
        extension: getFileExtensionFromNameOrContentType({
          name: metadata.name,
          contentType: metadata.mimeType,
        }),
      });
      const { signedUrl: uploadUrl, signedUrlExpiresAt: uploadUrlExpiresAt } =
        signS3ObjectUploadUrl({
          objectKey,
          contentType: metadata.mimeType,
          expiresInSeconds: 10 * 60,
        });
      const { signedUrl, signedUrlExpiresAt } = getCachedSignedS3ObjectUrl({
        objectKey,
        expiresInSeconds: 60 * 60,
      });

      return {
        success: true,
        data: {
          image: {
            objectKey,
            name: metadata.name,
            mimeType: metadata.mimeType,
            size: metadata.size,
            uploadUrl,
            uploadUrlExpiresAt,
            signedUrl,
            signedUrlExpiresAt,
          },
        },
      };
    } catch (error) {
      console.error("Failed to prepare logo detection debug image upload:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to prepare image upload.",
      };
    }
  });
}

export async function detectLogoBoxesAction(input: {
  objectKey: string;
  detectionLabelText: string;
}): Promise<ServerActionResult<DetectionUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      if (!isDebugPageEnabled()) {
        return {
          success: false,
          message: "Detection debug page is disabled.",
          code: "forbidden",
        };
      }

      const parsed = z
        .object({
          objectKey: z.string().trim().min(1),
          detectionLabelText: z.string().trim().min(1),
        })
        .parse(input);
      if (!isTeamLogoObjectKey(parsed.objectKey, teamId)) {
        return {
          success: false,
          message: "Only image files are supported.",
        };
      }

      const { signedUrl, signedUrlExpiresAt } = getCachedSignedS3ObjectUrl({
        objectKey: parsed.objectKey,
        expiresInSeconds: 60 * 60,
      });
      const detection = await detectBrandLogoBoxes({
        teamId,
        imageUrl: signedUrl,
        detectionLabelText: parsed.detectionLabelText,
      });

      return {
        success: true,
        data: {
          objectKey: parsed.objectKey,
          signedUrl,
          signedUrlExpiresAt,
          detections: detection.detections,
          found: detection.found,
          detectionLabelText: parsed.detectionLabelText,
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
