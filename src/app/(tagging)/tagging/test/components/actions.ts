"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { getCachedBrowserS3ObjectUrl } from "@/lib/s3";
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
      let objectKey: string | null = null;

      switch (featureType) {
        case "brand": {
          const image = await prisma.assetLogoImage.findFirst({
            where: {
              assetLogoId: featureId,
            },
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              objectKey: true,
            },
          });
          objectKey = image?.objectKey ?? null;
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
            },
          });
          objectKey = image?.objectKey ?? null;
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
            },
          });
          objectKey = image?.objectKey ?? null;
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
            },
          });
          objectKey = image?.objectKey ?? null;
          break;
        }
      }

      if (!objectKey) {
        return {
          success: false,
          message: "No image found for this feature",
        };
      }

      const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
        objectKey,
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
