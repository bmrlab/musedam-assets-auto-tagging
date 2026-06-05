"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { getCachedSignedOssObjectUrl } from "@/lib/oss";
import type { OssObjectIdentity } from "@/lib/oss-types";
import { ServerActionResult } from "@/lib/serverAction";
import prisma from "@/prisma/prisma";

type FeatureType = "brand" | "ip" | "product" | "person";

export async function getFeatureThumbnailAction(
  featureType: FeatureType,
  featureId: string,
): Promise<
  ServerActionResult<{
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async () => {
    try {
      let imageIdentity: OssObjectIdentity | null = null;

      switch (featureType) {
        case "brand": {
          const image = await prisma.assetLogoImage.findFirst({
            where: {
              assetLogoId: featureId,
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              objectKey: true,
              ossBucket: true,
              ossEndpoint: true,
              ossRegion: true,
            },
          });
          imageIdentity = image ?? null;
          break;
        }
        case "ip": {
          const image = await prisma.assetIpImage.findFirst({
            where: {
              assetIpId: featureId,
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              objectKey: true,
              ossBucket: true,
              ossEndpoint: true,
              ossRegion: true,
            },
          });
          imageIdentity = image ?? null;
          break;
        }
        case "product": {
          const image = await prisma.assetProductImage.findFirst({
            where: {
              assetProductId: featureId,
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              objectKey: true,
              ossBucket: true,
              ossEndpoint: true,
              ossRegion: true,
            },
          });
          imageIdentity = image ?? null;
          break;
        }
        case "person": {
          const image = await prisma.assetPersonImage.findFirst({
            where: {
              assetPersonId: featureId,
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              objectKey: true,
              ossBucket: true,
              ossEndpoint: true,
              ossRegion: true,
            },
          });
          imageIdentity = image ?? null;
          break;
        }
      }

      if (!imageIdentity) {
        return {
          success: false,
          message: "No image found for this feature",
        };
      }

      const { signedUrl, signedUrlExpiresAt } = await getCachedSignedOssObjectUrl({
        objectKey: imageIdentity.objectKey,
        location: {
          ossBucket: imageIdentity.ossBucket,
          ossEndpoint: imageIdentity.ossEndpoint,
          ossRegion: imageIdentity.ossRegion,
        },
      });

      return {
        success: true,
        data: {
          signedUrl,
          signedUrlExpiresAt,
        },
      };
    } catch (error) {
      console.error("Failed to get feature thumbnail:", error);
      return {
        success: false,
        message: "Failed to get feature thumbnail",
      };
    }
  });
}
