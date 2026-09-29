"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import type { FeatureThumbnails } from "@/app/(tagging)/tagging/review/feature-review";
import { loadFeatureThumbnails } from "@/app/(tagging)/tagging/review/feature-review-server";
import { getCachedBrowserS3ObjectUrl } from "@/lib/s3";
import { ServerActionResult } from "@/lib/serverAction";
import prisma from "@/prisma/prisma";

type FeatureType = "brand" | "ip" | "product" | "person";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getFeatureThumbnailAction(
  featureType: FeatureType,
  featureId: string,
): Promise<
  ServerActionResult<{
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      let objectKey: string | null = null;

      switch (featureType) {
        case "brand": {
          const image = await prisma.assetLogoImage.findFirst({
            where: {
              assetLogoId: featureId,
              assetLogo: { teamId },
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
              assetIp: { teamId },
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
              assetProduct: { teamId },
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
              assetPerson: { teamId },
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

const MAX_THUMBNAIL_KEYS = 500;
const FEATURE_TYPES: FeatureType[] = ["brand", "ip", "product", "person"];

/**
 * 批量签名特征首图（key 为 `type:id`）。测试结果里逐个特征调用 getFeatureThumbnailAction
 * 会让 Server Action 在客户端串行排队，这里一次性返回。只签当前团队的特征。
 */
export async function getFeatureThumbnailsAction(
  keys: string[],
): Promise<ServerActionResult<FeatureThumbnails>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const requested: Record<FeatureType, string[]> = {
        brand: [],
        ip: [],
        product: [],
        person: [],
      };
      for (const key of keys.slice(0, MAX_THUMBNAIL_KEYS)) {
        const [type, id] = key.split(":") as [FeatureType, string | undefined];
        if (FEATURE_TYPES.includes(type) && id) requested[type].push(id);
      }
      const uuidOnly = (ids: string[]) => ids.filter((id) => UUID_PATTERN.test(id));
      const where = (type: FeatureType) => ({ teamId, id: { in: uuidOnly(requested[type]) } });
      const select = { id: true } as const;
      const [brands, ips, products, persons] = await Promise.all([
        requested.brand.length ? prisma.assetLogo.findMany({ where: where("brand"), select }) : [],
        requested.ip.length ? prisma.assetIp.findMany({ where: where("ip"), select }) : [],
        requested.product.length
          ? prisma.assetProduct.findMany({ where: where("product"), select })
          : [],
        requested.person.length
          ? prisma.assetPerson.findMany({ where: where("person"), select })
          : [],
      ]);
      const toIds = (rows: { id: string }[]) => rows.map((row) => row.id);
      return {
        success: true,
        data: await loadFeatureThumbnails({
          brand: toIds(brands),
          ip: toIds(ips),
          product: toIds(products),
          person: toIds(persons),
        }),
      };
    } catch (error) {
      console.error("Failed to get feature thumbnails:", error);
      return {
        success: false,
        message: "Failed to get feature thumbnails",
      };
    }
  });
}
