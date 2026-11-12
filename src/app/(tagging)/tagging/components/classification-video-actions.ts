"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import type { AssetFeatureClassification } from "@/lib/feature-decision/classify";
import { classifyVideoAssetFeatures } from "@/lib/feature-decision/video-classification";
import { withVideoClassificationSlot } from "@/lib/feature-decision/video-classification-slot";
import { getDetectionDebugRequestMode } from "@/lib/media-process/debug-request-mode";
import { requestVideoFrames } from "@/lib/media-process/video-frames";
import {
  classifyPersonFaceEmbeddings,
  detectPersonFaceBoxes,
  type PersonClassificationResult,
  type PersonDetectionBox,
} from "@/lib/person/person-classification";
import {
  buildClassificationVideoObjectKey,
  getBrowserS3ObjectUploadUrl,
  getCachedSignedS3ObjectUrl,
  isClassificationVideoObjectKey,
} from "@/lib/s3";
import type { ServerActionResult } from "@/lib/serverAction";
import { fetchRemotePersonImageInput } from "@/lib/tagging/classification-image";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { MuseDAMID } from "@/musedam/types";
import { z } from "zod";
import { CLASSIFICATION_VIDEO_UPLOAD_LIMIT, getVideoExtension } from "./classification-video";

const assetIdSchema = z.string().regex(/^\d{1,32}$/);
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), objectKey: z.string().min(1).max(1024) }),
  z.object({ kind: z.literal("musedam"), assetId: assetIdSchema }),
]);
type VideoTeam = { id: number; slug: string };

async function fetchMuseDAMVideo(team: VideoTeam, assetId: string) {
  const { apiKey } = await retrieveTeamCredentials({ team });
  const assets = await requestMuseDAMAPI<
    Array<{
      id: MuseDAMID;
      name: string;
      extension?: string;
      downloadUrl?: string;
      thumbnailAccessUrl?: string;
    }>
  >("/api/muse/assets-by-ids", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: [MuseDAMID.from(assetId)],
  });
  const asset = assets?.find((item) => String(item.id) === assetId);
  if (!asset || !getVideoExtension(asset.name, asset.extension) || !asset.downloadUrl) {
    throw new Error("MuseDAM video or its download URL is unavailable");
  }
  return { name: asset.name, url: asset.downloadUrl, thumbnail: asset.thumbnailAccessUrl };
}

async function resolveVideo(team: VideoTeam, source: z.infer<typeof sourceSchema>) {
  if (source.kind === "musedam") return fetchMuseDAMVideo(team, source.assetId);
  if (
    !isClassificationVideoObjectKey(source.objectKey, team.id) ||
    !getVideoExtension(source.objectKey)
  ) {
    throw new Error("Invalid classification video upload");
  }
  const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey: source.objectKey });
  return { url: signedUrl, name: undefined, thumbnail: undefined };
}

export async function prepareClassificationVideoUploadAction(input: {
  name: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<{ objectKey: string; uploadUrl: string; contentType: string }>> {
  return withAuth(async ({ team }) => {
    const metadata = z
      .object({
        name: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(255),
        size: z.number().int().positive().max(CLASSIFICATION_VIDEO_UPLOAD_LIMIT),
      })
      .safeParse(input);
    const extension = metadata.success && getVideoExtension(metadata.data.name);
    if (!metadata.success || !extension) return { success: false, message: "Invalid video upload" };

    const mimeType = metadata.data.mimeType.toLowerCase();
    const contentType = /^video\/[a-z0-9.+-]+$/.test(mimeType)
      ? mimeType
      : "application/octet-stream";
    const objectKey = buildClassificationVideoObjectKey(team.id, extension);
    const { signedUrl: uploadUrl } = getBrowserS3ObjectUploadUrl({ objectKey, contentType });
    return { success: true, data: { objectKey, uploadUrl, contentType } };
  });
}

export async function importClassificationVideoAction(
  assetId: string,
): Promise<ServerActionResult<{ name: string; url: string; thumbnail?: string }>> {
  return withAuth(async ({ team }) => {
    try {
      return { success: true, data: await fetchMuseDAMVideo(team, assetIdSchema.parse(assetId)) };
    } catch (error) {
      console.error("Failed to load MuseDAM classification video:", error);
      return { success: false, message: "MuseDAM video is unavailable" };
    }
  });
}

export async function classifyFeatureVideoAction(input: {
  source: z.infer<typeof sourceSchema>;
  featureType: "logo" | "product" | "ip";
  imageMode: boolean;
  fileName: string;
  folderPath: string;
}): Promise<ServerActionResult<AssetFeatureClassification>> {
  return withAuth(async ({ team }) => {
    try {
      const metadata = z
        .object({
          source: sourceSchema,
          featureType: z.enum(["logo", "product", "ip"]),
          imageMode: z.boolean(),
          fileName: z.string().max(1000),
          folderPath: z.string().max(4000),
        })
        .parse(input);
      const result = await withVideoClassificationSlot(async () => {
        const video = await resolveVideo(team, metadata.source);
        return classifyVideoAssetFeatures({
          teamId: team.id,
          videoUrl: video.url,
          enabledTypes: [metadata.featureType],
          imageMode: metadata.imageMode,
          requestMode: getDetectionDebugRequestMode(),
          fileName: metadata.fileName,
          folderPath: metadata.folderPath,
        });
      });
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to classify feature video:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Video classification failed",
      };
    }
  });
}

export async function classifyPersonVideoAction(
  source: z.infer<typeof sourceSchema>,
): Promise<
  ServerActionResult<{ result: PersonClassificationResult; detections: PersonDetectionBox[] }>
> {
  return withAuth(async ({ team }) => {
    try {
      const parsedSource = sourceSchema.parse(source);
      const data = await withVideoClassificationSlot(async () => {
        const video = await resolveVideo(team, parsedSource);
        // Match the tagging queue's first-frame behavior for person classification.
        const thumbnail = video.thumbnail
          ? await fetchRemotePersonImageInput(video.thumbnail, "person video thumbnail").catch(
              () => null,
            )
          : null;
        const image =
          thumbnail ??
          (await (async () => {
            const [frame] = await requestVideoFrames(
              team.id,
              video.url,
              AbortSignal.timeout(4 * 60_000),
              1,
            );
            return fetchRemotePersonImageInput(frame.url, "person video frame");
          })());
        const { detections } = await detectPersonFaceBoxes({
          imageBase64: image.dataUrl,
          includeEmbedding: true,
        });
        const faces = detections.flatMap((box, detectionIndex) =>
          box.embedding ? [{ detectionIndex, box, embedding: box.embedding }] : [],
        );
        if (faces.length !== detections.length)
          throw new Error("Face detection returned a missing embedding");
        const result = await classifyPersonFaceEmbeddings({ teamId: team.id, faces });
        return { result, detections: detections.map(({ embedding, ...box }) => box) };
      });
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error("Failed to classify person video:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Video classification failed",
      };
    }
  });
}
