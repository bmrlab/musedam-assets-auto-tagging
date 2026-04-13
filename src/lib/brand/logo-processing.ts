import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
import { bufferToDataUrl } from "@/lib/brand/image";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import {
  BRAND_PROCESSING_ERROR_CODES,
  BrandProcessingErrorCode,
} from "@/lib/brand/processing-errors";
import {
  deleteLogoVectorPointsByLogo,
  ensureLogoVectorCollection,
  setLogoVectorPayloadByLogo,
  upsertLogoVectorPoints,
} from "@/lib/brand/qdrant";
import { getCachedSignedOssObjectUrl } from "@/lib/oss";
import prisma from "@/prisma/prisma";
import { randomUUID } from "crypto";

function createProcessingError(code: BrandProcessingErrorCode, cause?: unknown) {
  const error = new Error(code) as Error & {
    brandProcessingErrorCode: BrandProcessingErrorCode;
    cause?: unknown;
  };
  error.brandProcessingErrorCode = code;
  error.cause = cause;
  return error;
}

function getProcessingErrorCode(error: unknown): BrandProcessingErrorCode {
  if (
    error instanceof Error &&
    "brandProcessingErrorCode" in error &&
    typeof error.brandProcessingErrorCode === "string"
  ) {
    return error.brandProcessingErrorCode as BrandProcessingErrorCode;
  }

  const message = error instanceof Error ? error.message : "";

  if (message.includes("Jina embeddings request failed")) {
    return BRAND_PROCESSING_ERROR_CODES.jinaRequestFailed;
  }

  if (message.includes("Qdrant request failed")) {
    return BRAND_PROCESSING_ERROR_CODES.vectorStoreSyncFailed;
  }

  return BRAND_PROCESSING_ERROR_CODES.unknown;
}

async function fetchImageAsDataUrl(objectKey: string, mimeType: string) {
  const { signedUrl } = getCachedSignedOssObjectUrl({ objectKey });
  const response = await fetch(signedUrl);

  if (!response.ok) {
    throw createProcessingError(BRAND_PROCESSING_ERROR_CODES.imageFetchFailed);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return bufferToDataUrl(buffer, mimeType);
}

export async function markAssetLogoVectorsProcessing({
  teamId,
  logoId,
  enabled,
}: {
  teamId: number;
  logoId: string;
  enabled: boolean;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.assetLogo.update({
      where: {
        id: logoId,
      },
      data: {
        status: "processing",
        processingError: null,
        processedAt: null,
      },
    });

    await tx.assetLogoImage.updateMany({
      where: {
        assetLogoId: logoId,
      },
      data: {
        qdrantPointId: null,
        embeddingModel: null,
        embeddedAt: null,
      },
    });
  });

  await setLogoVectorPayloadByLogo({
    teamId,
    assetLogoId: logoId,
    payload: {
      enabled,
      status: "processing",
    },
  }).catch((error) => {
    console.warn("Failed to mark Qdrant payload as processing:", error);
  });
}

export async function processAssetLogoReferenceVectors({
  teamId,
  logoId,
}: {
  teamId: number;
  logoId: string;
}) {
  try {
    const logo = await prisma.assetLogo.findFirst({
      where: {
        id: logoId,
        teamId,
      },
      include: {
        images: {
          orderBy: [{ sort: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!logo) {
      throw createProcessingError(BRAND_PROCESSING_ERROR_CODES.logoNotFound);
    }

    if (logo.images.length === 0) {
      throw createProcessingError(BRAND_PROCESSING_ERROR_CODES.noReferenceImages);
    }

    const imageInputs = await Promise.all(
      logo.images.map((image) => fetchImageAsDataUrl(image.objectKey, image.mimeType)),
    );
    const embeddings = await createJinaImageEmbeddings({
      images: imageInputs,
    });

    if (embeddings.length !== logo.images.length) {
      throw createProcessingError(BRAND_PROCESSING_ERROR_CODES.embeddingCountMismatch);
    }

    await ensureLogoVectorCollection(embeddings[0].length);
    await deleteLogoVectorPointsByLogo({
      teamId,
      assetLogoId: logo.id,
    });

    const pointIds = logo.images.map(() => randomUUID());
    await upsertLogoVectorPoints(
      logo.images.map((image, index) => ({
        id: pointIds[index],
        vector: embeddings[index],
        payload: {
          teamId,
          assetLogoId: logo.id,
          assetLogoImageId: image.id,
          logoTypeId: logo.logoTypeId,
          enabled: logo.enabled,
          status: "completed",
        },
      })),
    );

    const processedAt = new Date();
    const embeddingModel = getJinaConfig().model;

    await prisma.$transaction(async (tx) => {
      await tx.assetLogo.update({
        where: {
          id: logo.id,
        },
        data: {
          status: "completed",
          processingError: null,
          processedAt,
        },
      });

      await Promise.all(
        logo.images.map((image, index) =>
          tx.assetLogoImage.update({
            where: {
              id: image.id,
            },
            data: {
              qdrantPointId: pointIds[index],
              embeddingModel,
              embeddedAt: processedAt,
            },
          }),
        ),
      );
    });
  } catch (error) {
    const message = getProcessingErrorCode(error);

    await prisma.assetLogo
      .update({
        where: {
          id: logoId,
        },
        data: {
          status: "failed",
          processingError: message,
        },
      })
      .catch(() => undefined);

    await setLogoVectorPayloadByLogo({
      teamId,
      assetLogoId: logoId,
      payload: {
        status: "failed",
      },
    }).catch(() => undefined);

    throw error;
  }
}
