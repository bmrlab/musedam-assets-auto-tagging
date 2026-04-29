import "server-only";

import { getCachedSignedOssObjectUrl } from "@/lib/oss";
import prisma from "@/prisma/prisma";
import { randomUUID } from "crypto";
import { detectPersonFaces, generateFaceEmbedding } from "./face-api";
import {
  deletePersonVectorPointsByPerson,
  ensurePersonVectorCollection,
  setPersonVectorPayloadByPerson,
  upsertPersonVectorPoints,
} from "./qdrant";

export const PERSON_PROCESSING_ERROR_CODES = {
  faceCountNotOne: "face_count_not_one",
  faceDetectionFailed: "face_detection_failed",
  generateEmbeddingFailed: "generate_embedding_failed",
  imageFetchFailed: "image_fetch_failed",
  noReferenceImages: "no_reference_images",
  personNotFound: "person_not_found",
  unknown: "unknown",
  vectorStoreSyncFailed: "vector_store_sync_failed",
} as const;

export type PersonProcessingErrorCode =
  (typeof PERSON_PROCESSING_ERROR_CODES)[keyof typeof PERSON_PROCESSING_ERROR_CODES];

export type PersonProcessingError = Error & {
  personProcessingErrorCode: PersonProcessingErrorCode;
  cause?: unknown;
  identifier?: string;
  actualFaceCount?: number;
};

function createProcessingError(code: PersonProcessingErrorCode, cause?: unknown): PersonProcessingError {
  const error = new Error(code) as PersonProcessingError;
  error.personProcessingErrorCode = code;
  error.cause = cause;
  return error;
}

function getProcessingErrorCode(error: unknown): PersonProcessingErrorCode {
  if (
    error instanceof Error &&
    "personProcessingErrorCode" in error &&
    typeof error.personProcessingErrorCode === "string"
  ) {
    return error.personProcessingErrorCode as PersonProcessingErrorCode;
  }

  const message = error instanceof Error ? error.message : "";

  if (message.includes("Face detection request failed")) {
    return PERSON_PROCESSING_ERROR_CODES.faceDetectionFailed;
  }

  if (message.includes("Generate face embedding request failed")) {
    return PERSON_PROCESSING_ERROR_CODES.generateEmbeddingFailed;
  }

  if (message.includes("Qdrant request failed")) {
    return PERSON_PROCESSING_ERROR_CODES.vectorStoreSyncFailed;
  }

  return PERSON_PROCESSING_ERROR_CODES.unknown;
}

export async function assertSingleFaceReferenceImage({
  objectKey,
  identifier,
}: {
  objectKey: string;
  identifier?: string;
}) {
  const { signedUrl } = getCachedSignedOssObjectUrl({ objectKey });
  const detection = await detectPersonFaces({
    imageUrl: signedUrl,
    includeEmbedding: false,
  });

  if (detection.faceCount !== 1 || detection.detections.length !== 1) {
    const error = createProcessingError(PERSON_PROCESSING_ERROR_CODES.faceCountNotOne);
    error.identifier = identifier || objectKey;
    error.actualFaceCount = detection.faceCount;
    throw error;
  }

  return {
    signedUrl,
    face: detection.detections[0],
  };
}

export async function markAssetPersonVectorsProcessing({
  teamId,
  personId,
  enabled,
}: {
  teamId: number;
  personId: string;
  enabled: boolean;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.assetPerson.update({
      where: {
        id: personId,
      },
      data: {
        status: "processing",
        processingError: null,
        processedAt: null,
      },
    });

    await tx.assetPersonImage.updateMany({
      where: {
        assetPersonId: personId,
      },
      data: {
        qdrantPointId: null,
        embeddingModel: null,
        embeddedAt: null,
      },
    });
  });

  await setPersonVectorPayloadByPerson({
    teamId,
    assetPersonId: personId,
    payload: {
      enabled,
      status: "processing",
    },
  }).catch((error) => {
    console.warn("Failed to mark person vector payload as processing:", error);
  });
}

export async function processAssetPersonReferenceVectors({
  teamId,
  personId,
}: {
  teamId: number;
  personId: string;
}) {
  try {
    const person = await prisma.assetPerson.findFirst({
      where: {
        id: personId,
        teamId,
      },
      include: {
        images: {
          orderBy: [{ sort: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!person) {
      throw createProcessingError(PERSON_PROCESSING_ERROR_CODES.personNotFound);
    }

    if (person.images.length === 0) {
      throw createProcessingError(PERSON_PROCESSING_ERROR_CODES.noReferenceImages);
    }

    const embeddingResults = await Promise.all(
      person.images.map(async (image) => {
        const { signedUrl, face } = await assertSingleFaceReferenceImage({
          objectKey: image.objectKey,
        });
        const embedding = await generateFaceEmbedding({
          imageUrl: signedUrl,
          face,
        });

        return {
          image,
          embedding,
        };
      }),
    );

    const vectorSize = embeddingResults[0]?.embedding.embedding.dimension;
    if (!vectorSize) {
      throw createProcessingError(PERSON_PROCESSING_ERROR_CODES.generateEmbeddingFailed);
    }

    await ensurePersonVectorCollection(vectorSize);
    await deletePersonVectorPointsByPerson({
      teamId,
      assetPersonId: person.id,
    });

    const pointIds = person.images.map(() => randomUUID());
    await upsertPersonVectorPoints(
      embeddingResults.map(({ image, embedding }, index) => ({
        id: pointIds[index],
        vector: embedding.embedding.vector,
        payload: {
          teamId,
          assetPersonId: person.id,
          assetPersonImageId: image.id,
          personTypeId: person.personTypeId,
          enabled: person.enabled,
          status: "completed",
        },
      })),
    );

    const processedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.assetPerson.update({
        where: {
          id: person.id,
        },
        data: {
          status: "completed",
          processingError: null,
          processedAt,
        },
      });

      await Promise.all(
        embeddingResults.map(({ image, embedding }, index) =>
          tx.assetPersonImage.update({
            where: {
              id: image.id,
            },
            data: {
              qdrantPointId: pointIds[index],
              embeddingModel: embedding.embedding.model_name,
              embeddedAt: processedAt,
            },
          }),
        ),
      );
    });
  } catch (error) {
    const message = getProcessingErrorCode(error);

    await prisma.assetPerson
      .update({
        where: {
          id: personId,
        },
        data: {
          status: "failed",
          processingError: message,
        },
      })
      .catch(() => undefined);

    await setPersonVectorPayloadByPerson({
      teamId,
      assetPersonId: personId,
      payload: {
        status: "failed",
      },
    }).catch(() => undefined);

    throw error;
  }
}
