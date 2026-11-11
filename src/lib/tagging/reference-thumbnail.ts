import "server-only";

import { rootLogger } from "@/lib/logging";
import { getCachedBrowserS3ObjectUrl, uploadS3Object } from "@/lib/s3";
import { getSvgRasterDensity } from "@/lib/tagging/svg-rasterization";
import sharp from "sharp";
import { withImageDecodeSlot } from "./image-memory";

// 特征库参考图的缩略图。S3 不支持通过 URL 参数缩放，列表里几十张 ~1000px 原图当小图显示很慢，
// 所以处理参考图时顺带生成一张小图存回 S3。key 由原 objectKey 推导，不需要额外字段 / migration。
const THUMBNAIL_MAX_DIMENSION = 256;
const THUMBNAIL_JPEG_QUALITY = 80;
const BACKGROUND_BUFFER_BUDGET = 16 * 1024 * 1024;
let backgroundBufferBytes = 0;

export function getReferenceThumbnailKey(objectKey: string) {
  return `${objectKey}.thumb.jpg`;
}

/** 校正 EXIF 方向、白底铺平透明区域，缩到长边不超过 256 的 JPEG。 */
export async function generateReferenceThumbnail(buffer: Buffer) {
  const density = getSvgRasterDensity(await sharp(buffer).metadata(), THUMBNAIL_MAX_DIMENSION);
  return withImageDecodeSlot("reference-thumbnail", () =>
    sharp(buffer, {
      limitInputPixels: 120_000_000,
      sequentialRead: true,
      ...(density === null ? {} : { density }),
    })
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_DIMENSION,
        height: THUMBNAIL_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: density === null,
      })
      .flatten({ background: "#fff" })
      .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
      .toBuffer(),
  );
}

export async function uploadReferenceThumbnail(objectKey: string, buffer: Buffer) {
  await uploadS3Object({
    body: await generateReferenceThumbnail(buffer),
    contentType: "image/jpeg",
    objectKey: getReferenceThumbnailKey(objectKey),
  });
}

/**
 * 参考图处理流程里顺带生成缩略图：不等待、不抛错，失败只记 warn，绝不影响向量处理结果。
 * 生成失败时前端会自动退回原图。
 */
export function scheduleReferenceThumbnail(objectKey: string, buffer: Buffer) {
  // Fire-and-forget callers must not retain an unbounded queue of original Buffers
  // behind the shared decoder. Missing thumbnails use the original and can be backfilled.
  if (backgroundBufferBytes + buffer.length > BACKGROUND_BUFFER_BUDGET) {
    rootLogger.info({ msg: "Reference thumbnail deferred by memory budget", objectKey });
    return;
  }
  backgroundBufferBytes += buffer.length;
  void uploadReferenceThumbnail(objectKey, buffer)
    .catch((error) => {
      rootLogger.warn({ msg: "Failed to generate reference thumbnail", objectKey, err: error });
    })
    .finally(() => {
      backgroundBufferBytes -= buffer.length;
    });
}

/** 缩略图签名 URL（与原图同样的签名方式）；对象不存在时前端加载失败会退回原图。 */
export function getReferenceThumbnailUrl(objectKey: string) {
  const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
    objectKey: getReferenceThumbnailKey(objectKey),
  });
  return { thumbnailUrl: signedUrl, thumbnailUrlExpiresAt: signedUrlExpiresAt };
}
