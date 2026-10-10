import "server-only";

import { signS3ObjectUrl } from "@/lib/s3";

/** Fresh seven-day URLs use the S3 SigV4 maximum and avoid nearly expired cache entries. */
export function signObjectDetectionImageUrl(objectKey: string) {
  return signS3ObjectUrl({ objectKey, expiresInSeconds: 7 * 24 * 60 * 60 });
}
