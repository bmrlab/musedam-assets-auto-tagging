import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
import { bufferToDataUrl } from "@/lib/brand/image";
import { createJinaImageEmbeddings, createJinaTextEmbeddings } from "@/lib/brand/jina";
import { getCachedSignedS3ObjectUrl } from "@/lib/s3";
import { cropImageToDataUrl as cropClassificationImageToDataUrl } from "@/lib/tagging/classification-image";
import { translateTextToEnglish } from "@/lib/translation/service";
import prisma from "@/prisma/prisma";
import { randomUUID } from "crypto";
import {
  deleteIpVectorPointsByIp,
  setIpVectorPayloadByIp,
  upsertIpVectorPoints,
} from "./pgvector";

const IP_PROCESSING_ERROR_CODES = {
  embeddingCountMismatch: "embedding_count_mismatch",
  imageFetchFailed: "image_fetch_failed",
  ipNotFound: "ip_not_found",
  jinaRequestFailed: "jina_request_failed",
  noReferenceImages: "no_reference_images",
  unknown: "unknown",
  vectorStoreSyncFailed: "vector_store_sync_failed",
} as const;

type IpProcessingErrorCode =
  (typeof IP_PROCESSING_ERROR_CODES)[keyof typeof IP_PROCESSING_ERROR_CODES];

function createProcessingError(code: IpProcessingErrorCode, cause?: unknown) {
  const error = new Error(code) as Error & {
    ipProcessingErrorCode: IpProcessingErrorCode;
    cause?: unknown;
  };
  error.ipProcessingErrorCode = code;
  error.cause = cause;
  return error;
}

function getProcessingErrorCode(error: unknown): IpProcessingErrorCode {
  if (
    error instanceof Error &&
    "ipProcessingErrorCode" in error &&
    typeof error.ipProcessingErrorCode === "string"
  ) {
    return error.ipProcessingErrorCode as IpProcessingErrorCode;
  }

  const message = error instanceof Error ? error.message : "";

  if (message.includes("Jina embeddings request failed")) {
    return IP_PROCESSING_ERROR_CODES.jinaRequestFailed;
  }

  if (message.includes("pgvector") || message.includes("vector")) {
    return IP_PROCESSING_ERROR_CODES.vectorStoreSyncFailed;
  }

  return IP_PROCESSING_ERROR_CODES.unknown;
}

async function fetchImageAsDataUrl(objectKey: string, mimeType: string): Promise<{ dataUrl: string; buffer: Buffer }> {
  const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
  const response = await fetch(signedUrl);

  if (!response.ok) {
    throw createProcessingError(IP_PROCESSING_ERROR_CODES.imageFetchFailed);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { dataUrl: bufferToDataUrl(buffer, mimeType), buffer };
}

function hasPartialCrop(image: {
  partialMatchPatternName: string | null;
  cropXMin: number | null;
  cropYMin: number | null;
  cropXMax: number | null;
  cropYMax: number | null;
  cropImageWidth: number | null;
  cropImageHeight: number | null;
}) {
  return (
    Boolean(image.partialMatchPatternName) &&
    typeof image.cropXMin === "number" &&
    typeof image.cropYMin === "number" &&
    typeof image.cropXMax === "number" &&
    typeof image.cropYMax === "number" &&
    typeof image.cropImageWidth === "number" &&
    typeof image.cropImageHeight === "number"
  );
}

async function buildReferenceImageInput({
  matchPattern,
  image,
}: {
  matchPattern: "whole" | "partial";
  image: {
    objectKey: string;
    mimeType: string;
    partialMatchPatternName: string | null;
    cropXMin: number | null;
    cropYMin: number | null;
    cropXMax: number | null;
    cropYMax: number | null;
    cropImageWidth: number | null;
    cropImageHeight: number | null;
  };
}) {
  const { dataUrl, buffer } = await fetchImageAsDataUrl(image.objectKey, image.mimeType);

  if (matchPattern !== "partial") {
    return dataUrl;
  }

  if (!hasPartialCrop(image)) {
    throw createProcessingError(IP_PROCESSING_ERROR_CODES.noReferenceImages);
  }

  return cropClassificationImageToDataUrl({
    imageDataUrl: dataUrl,
    imageBuffer: buffer,
    sourceMimeType: image.mimeType,
    meta: {
      width: image.cropImageWidth!,
      height: image.cropImageHeight!,
    },
    box: {
      xMin: image.cropXMin!,
      yMin: image.cropYMin!,
      xMax: image.cropXMax!,
      yMax: image.cropYMax!,
      score: 1,
      label: image.partialMatchPatternName!,
    },
  });
}

export async function markAssetIpVectorsProcessing({
  teamId,
  ipId,
  enabled,
}: {
  teamId: number;
  ipId: string;
  enabled: boolean;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.assetIp.update({
      where: {
        id: ipId,
      },
      data: {
        status: "processing",
        processingError: null,
        processedAt: null,
      },
    });

    await tx.assetIpImage.updateMany({
      where: {
        assetIpId: ipId,
      },
      data: {
        pgvectorPointId: null,
        embeddingModel: null,
        embeddedAt: null,
      },
    });
  });

  await setIpVectorPayloadByIp({
    teamId,
    assetIpId: ipId,
    payload: {
      enabled,
      status: "processing",
    },
  }).catch((error) => {
    console.warn("Failed to mark IP vector payload as processing:", error);
  });
}

export async function processAssetIpReferenceVectors({
  teamId,
  ipId,
}: {
  teamId: number;
  ipId: string;
}) {
  try {
    const ip = await prisma.assetIp.findFirst({
      where: {
        id: ipId,
        teamId,
      },
      include: {
        images: {
          orderBy: [{ sort: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!ip) {
      throw createProcessingError(IP_PROCESSING_ERROR_CODES.ipNotFound);
    }

    if (ip.images.length === 0) {
      throw createProcessingError(IP_PROCESSING_ERROR_CODES.noReferenceImages);
    }

    const imageInputs = await Promise.all(
      ip.images.map((image) =>
        buildReferenceImageInput({
          matchPattern: ip.matchPattern,
          image,
        }),
      ),
    );
    const imageEmbeddings = await createJinaImageEmbeddings({
      images: imageInputs,
    });

    if (imageEmbeddings.length !== ip.images.length) {
      throw createProcessingError(IP_PROCESSING_ERROR_CODES.embeddingCountMismatch);
    }

    const normalizedDescription = ip.description.trim();
    const descriptionEmbeddings = normalizedDescription
      ? await createJinaTextEmbeddings({
          texts: [await translateTextToEnglish(normalizedDescription)],
        })
      : [];

    const vectorSize = imageEmbeddings[0]?.length ?? descriptionEmbeddings[0]?.length;
    if (!vectorSize) {
      throw createProcessingError(IP_PROCESSING_ERROR_CODES.embeddingCountMismatch);
    }

    await deleteIpVectorPointsByIp({
      teamId,
      assetIpId: ip.id,
    });

    const imagePointIds = ip.images.map(() => randomUUID());
    const vectorPoints: Array<{
      id: string;
      vector: number[];
      payload: {
        teamId: number;
        assetIpId: string;
        assetIpImageId: string | null;
        ipTypeId: string | null;
        enabled: boolean;
        matchPattern: "whole" | "partial";
        partialMatchPatternName: string | null;
        status: "completed";
        sourceType: "image" | "description";
      };
    }> = ip.images.map((image, index) => ({
      id: imagePointIds[index],
      vector: imageEmbeddings[index],
      payload: {
        teamId,
        assetIpId: ip.id,
        assetIpImageId: image.id,
        ipTypeId: ip.ipTypeId,
        enabled: ip.enabled,
        matchPattern: ip.matchPattern,
        partialMatchPatternName:
          ip.matchPattern === "partial" ? image.partialMatchPatternName : null,
        status: "completed",
        sourceType: "image",
      },
    }));

    if (descriptionEmbeddings.length > 0) {
      vectorPoints.push({
        id: randomUUID(),
        vector: descriptionEmbeddings[0],
        payload: {
          teamId,
          assetIpId: ip.id,
          assetIpImageId: null,
          ipTypeId: ip.ipTypeId,
          enabled: ip.enabled,
          matchPattern: ip.matchPattern,
          partialMatchPatternName: null,
          status: "completed" as const,
          sourceType: "description" as const,
        },
      });
    }

    await upsertIpVectorPoints(vectorPoints);

    const processedAt = new Date();
    const embeddingModel = getJinaConfig().model;

    await prisma.$transaction(async (tx) => {
      await tx.assetIp.update({
        where: {
          id: ip.id,
        },
        data: {
          status: "completed",
          processingError: null,
          processedAt,
        },
      });

      await Promise.all(
        ip.images.map((image, index) =>
          tx.assetIpImage.update({
            where: {
              id: image.id,
            },
            data: {
              pgvectorPointId: imagePointIds[index],
              embeddingModel,
              embeddedAt: processedAt,
            },
          }),
        ),
      );
    });
  } catch (error) {
    const message = getProcessingErrorCode(error);

    await prisma.assetIp
      .update({
        where: {
          id: ipId,
        },
        data: {
          status: "failed",
          processingError: message,
        },
      })
      .catch(() => undefined);

    await setIpVectorPayloadByIp({
      teamId,
      assetIpId: ipId,
      payload: {
        status: "failed",
      },
    }).catch(() => undefined);

    throw error;
  }
}
