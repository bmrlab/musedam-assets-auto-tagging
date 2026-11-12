"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { isVideoAssetExtension, toFeatureClassificationFlags } from "@/lib/feature-library";
import { getServerFeatureLibraryFeatures } from "@/lib/feature-library-server";
import { requestVideoFrames } from "@/lib/media-process/video-frames";
import {
  getCachedBrowserS3ObjectUrl,
  getCachedSignedS3ObjectUrl,
  isClassificationVideoObjectKey,
  uploadS3Object,
} from "@/lib/s3";
import { ServerActionResult } from "@/lib/serverAction";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { MuseDAMID } from "@/musedam/types";
import type { AssetObjectExtra } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { randomUUID } from "crypto";
import sharp from "sharp";
import pLimit from "p-limit";

interface SelectedAsset {
  source?: "local";
  id: string; // 素材唯一标识
  name: string; // 素材名称
  extension: string; // 文件扩展名
  size: number; // 文件大小（字节）
  url?: string; // 素材访问链接
  thumbnail?: {
    url?: string; // 缩略图链接
  };
  width?: number; // 图片宽度（图片类型）
  height?: number; // 图片高度（图片类型）
  type?: string; // 素材类型
  folderId?: string; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

export async function startTaggingTasksAction(
  selectedAssets: SelectedAsset[],
  options?: {
    matchingSources?: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy?: "precise" | "balanced" | "broad";
  },
): Promise<
  ServerActionResult<{
    successCount: number;
    failedCount: number;
    failedAssets: { name: string; reason: string }[];
    queueItemIds: number[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      let successCount = 0;
      let failedCount = 0;
      const failedAssets: { name: string; reason: string }[] = [];
      const queueItemIds: number[] = [];
      const featureLibraryFeatures = await getServerFeatureLibraryFeatures();

      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { id: true, slug: true },
      });
      const limit = pLimit(4);
      const outcomes = await Promise.all(
        selectedAssets.map((asset) =>
          limit(async () => {
            try {
              const localAsset =
                asset.source === "local"
                  ? await prisma.assetObject.findFirstOrThrow({
                      where: { teamId, slug: { equals: asset.id, startsWith: "local-test-" } },
                    })
                  : null;

              if (localAsset) {
                const extra = localAsset.extra as AssetObjectExtra & { objectKey?: string };
                if (extra.objectKey) {
                  const { signedUrl } = getCachedSignedS3ObjectUrl({
                    objectKey: extra.objectKey,
                    expiresInSeconds: 24 * 60 * 60,
                  });
                  const thumbnailAccessUrl = isVideoAssetExtension(extra.extension)
                    ? (await requestVideoFrames(teamId, signedUrl, AbortSignal.timeout(4 * 60_000), 1))[0].url
                    : signedUrl;
                  localAsset.extra = {
                    ...extra,
                    thumbnailAccessUrl,
                    downloadUrl: signedUrl,
                  };
                  await prisma.assetObject.update({
                    where: { id: localAsset.id },
                    data: { extra: localAsset.extra },
                  });
                }
              }

              // 1. 从 MuseDAM 同步素材到本地数据库
              const assetObject =
                localAsset ??
                (
                  await syncSingleAssetFromMuseDAM({
                    musedamAssetId: MuseDAMID.from(asset.id),
                    team,
                  })
                ).assetObject;

              // 2. 发起 AI 打标任务
              const taggingQueueItem = await enqueueTaggingTask({
                assetObject,
                matchingSources: options?.matchingSources,
                recognitionAccuracy: options?.recognitionAccuracy,
                featureClassify: featureLibraryFeatures.featureLibrary,
                featureClassifications: toFeatureClassificationFlags(featureLibraryFeatures),
                taskType: "test",
              });

              return { id: taggingQueueItem.id };
            } catch (error) {
              console.error(`Error starting tagging for asset ${asset.name} (${asset.id}):`, error);
              return {
                failure: {
                  name: asset.name || asset.id,
                  reason: error instanceof Error ? error.message : String(error),
                },
              };
            }
          }),
        ),
      );
      for (const outcome of outcomes) {
        if (outcome.failure) {
          failedCount++;
          failedAssets.push(outcome.failure);
        } else if (outcome.id !== undefined) {
          successCount++;
          queueItemIds.push(outcome.id);
        }
      }

      return {
        success: true,
        data: {
          successCount,
          failedCount,
          failedAssets,
          queueItemIds,
        },
      };
    } catch (error) {
      console.error("批量发起打标任务失败:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function registerLocalTestVideoAction(input: {
  objectKey: string;
  name: string;
  size: number;
}): Promise<ServerActionResult<SelectedAsset>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const extension = input.name.split(".").pop()?.toLowerCase() ?? "";
    if (
      !isClassificationVideoObjectKey(input.objectKey, teamId) ||
      !isVideoAssetExtension(extension) ||
      !input.objectKey.endsWith(`.${extension}`) ||
      !Number.isSafeInteger(input.size) ||
      input.size <= 0 ||
      input.size > 200 * 1024 * 1024
    ) {
      return { success: false, message: "Invalid video upload." };
    }
    const slug = `local-test-${randomUUID()}`;
    const { signedUrl: url } = getCachedSignedS3ObjectUrl({
      objectKey: input.objectKey,
      expiresInSeconds: 86400,
    });
    const [frame] = await requestVideoFrames(teamId, url, AbortSignal.timeout(4 * 60_000), 1);
    await prisma.assetObject.create({
      data: {
        teamId,
        slug,
        name: input.name,
        materializedPath: "",
        description: "",
        extra: {
          extension,
          size: input.size,
          objectKey: input.objectKey,
          downloadUrl: url,
          thumbnailAccessUrl: frame.url,
          localTest: true,
        },
      },
    });
    return {
      success: true,
      data: {
        id: slug,
        source: "local",
        name: input.name,
        extension,
        size: input.size,
        url,
        thumbnail: { url: frame.url },
      },
    };
  });
}

/** Local test inputs stay in this application's storage and never enter DAM. */
export async function uploadLocalTestFileAction(
  formData: FormData,
): Promise<ServerActionResult<SelectedAsset>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) {
        return { success: false, message: "Select an image up to 20 MB." };
      }
      // Decode the contents instead of trusting the browser's MIME type.
      const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 100_000_000 });
      const { data, info } = await image
        .rotate()
        .jpeg({ quality: 90 })
        .toBuffer({ resolveWithObject: true });
      const slug = `local-test-${randomUUID()}`;
      const objectKey = `teams-${teamId}-tagging-test-${randomUUID()}.jpg`;
      const uploaded = await uploadS3Object({ objectKey, body: data, contentType: "image/jpeg" });
      const { signedUrl: url } = getCachedSignedS3ObjectUrl({
        objectKey: uploaded.objectKey,
        expiresInSeconds: 24 * 60 * 60,
      });
      const { signedUrl: previewUrl } = getCachedBrowserS3ObjectUrl({
        objectKey: uploaded.objectKey,
        expiresInSeconds: 24 * 60 * 60,
      });
      await prisma.assetObject.create({
        data: {
          teamId,
          slug,
          name: file.name,
          materializedPath: "",
          description: "",
          extra: {
            extension: "jpg",
            size: file.size,
            width: info.width,
            height: info.height,
            objectKey: uploaded.objectKey,
            thumbnailAccessUrl: url,
            downloadUrl: url,
            localTest: true,
          },
        },
      });
      return {
        success: true,
        data: {
          id: slug,
          source: "local",
          name: file.name,
          extension: "jpg",
          size: file.size,
          width: info.width,
          height: info.height,
          url,
          thumbnail: { url: previewUrl },
        },
      };
    } catch (error) {
      console.error("Local test upload failed", error);
      return {
        success: false,
        message: "Unable to upload image. Check the image and storage configuration.",
      };
    }
  });
}
