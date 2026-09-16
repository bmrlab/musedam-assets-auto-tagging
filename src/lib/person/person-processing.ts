import "server-only";

import { getCachedSignedS3ObjectUrl } from "@/lib/s3";
import { fetchRemotePersonImageInput } from "@/lib/tagging/classification-image";
import prisma from "@/prisma/prisma";
import { randomUUID } from "crypto";
import pLimit from "p-limit";
import { detectPersonFaces, generateFaceEmbedding } from "./face-api";
import {
  deletePersonVectorPointsByPerson,
  setPersonVectorPayloadByPerson,
  upsertPersonVectorPoints,
} from "./pgvector";

const PERSON_VECTOR_PROCESSING_CONCURRENCY = 8;
const PERSON_FACE_PROCESSING_CONCURRENCY = 8;
const PERSON_VECTOR_RECOVERY_BATCH_SIZE = 32;
const PERSON_VECTOR_PROCESSING_HEARTBEAT_MS = 15_000;
const PERSON_VECTOR_PROCESSING_STALE_MS = 60_000;
const personVectorProcessingLimit = pLimit(PERSON_VECTOR_PROCESSING_CONCURRENCY);
const personFaceProcessingLimit = pLimit(PERSON_FACE_PROCESSING_CONCURRENCY);
const inFlightPersonVectorProcessing = new Map<string, Promise<void>>();

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

function createProcessingError(
  code: PersonProcessingErrorCode,
  cause?: unknown,
): PersonProcessingError {
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

  if (message.includes("pgvector") || message.includes("vector")) {
    return PERSON_PROCESSING_ERROR_CODES.vectorStoreSyncFailed;
  }

  return PERSON_PROCESSING_ERROR_CODES.unknown;
}

function serializeProcessingError(error: unknown) {
  const code = getProcessingErrorCode(error);

  if (code !== PERSON_PROCESSING_ERROR_CODES.faceCountNotOne || !(error instanceof Error)) {
    return code;
  }

  const personError = error as Partial<PersonProcessingError>;
  return JSON.stringify({
    code,
    ...(typeof personError.identifier === "string" ? { identifier: personError.identifier } : {}),
    ...(typeof personError.actualFaceCount === "number" &&
    Number.isFinite(personError.actualFaceCount)
      ? { actualFaceCount: personError.actualFaceCount }
      : {}),
  });
}

export async function assertSingleFaceReferenceImage({
  objectKey,
  identifier,
}: {
  objectKey: string;
  identifier?: string;
}) {
  const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
  const imageInput = await fetchRemotePersonImageInput(signedUrl, "person face detection");
  const detection = await detectPersonFaces({
    imageBase64: imageInput.dataUrl,
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
    imageInput,
  };
}

export async function markAssetPersonVectorsPending({
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
        status: "pending",
        processingError: null,
        processedAt: null,
      },
    });

    await tx.assetPersonImage.updateMany({
      where: {
        assetPersonId: personId,
      },
      data: {
        pgvectorPointId: null,
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

async function processAssetPersonReferenceVectorsNow({
  teamId,
  personId,
}: {
  teamId: number;
  personId: string;
}) {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  try {
    const claimed = await prisma.assetPerson.updateMany({
      where: {
        id: personId,
        teamId,
        status: {
          in: ["pending", "processing"],
        },
      },
      data: {
        status: "processing",
        processingError: null,
        processedAt: null,
      },
    });

    if (claimed.count === 0) {
      return;
    }

    heartbeat = setInterval(() => {
      void prisma.assetPerson
        .updateMany({
          where: {
            id: personId,
            teamId,
            status: "processing",
          },
          data: {
            status: "processing",
          },
        })
        .catch((error) => {
          console.warn(`Failed to heartbeat asset Person vectors (${personId}):`, error);
        });
    }, PERSON_VECTOR_PROCESSING_HEARTBEAT_MS);

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
      person.images.map((image, index) =>
        personFaceProcessingLimit(async () => {
          const { face, imageInput } = await assertSingleFaceReferenceImage({
            objectKey: image.objectKey,
            identifier: `image ${index + 1}`,
          });
          const embedding = await generateFaceEmbedding({
            imageBase64: imageInput.dataUrl,
            face,
          });

          return {
            image,
            embedding,
          };
        }),
      ),
    );

    const vectorSize = embeddingResults[0]?.embedding.embedding.dimension;
    if (!vectorSize) {
      throw createProcessingError(PERSON_PROCESSING_ERROR_CODES.generateEmbeddingFailed);
    }

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
              pgvectorPointId: pointIds[index],
              embeddingModel: embedding.embedding.model_name,
              embeddedAt: processedAt,
            },
          }),
        ),
      );
    });
  } catch (error) {
    const message = serializeProcessingError(error);

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
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}

export function processAssetPersonReferenceVectors({
  teamId,
  personId,
}: {
  teamId: number;
  personId: string;
}) {
  const existing = inFlightPersonVectorProcessing.get(personId);
  if (existing) {
    return existing;
  }

  const processingPromise = personVectorProcessingLimit(() =>
    processAssetPersonReferenceVectorsNow({ teamId, personId }),
  );
  const trackedPromise: Promise<void> = processingPromise.finally(() => {
    if (inFlightPersonVectorProcessing.get(personId) === trackedPromise) {
      inFlightPersonVectorProcessing.delete(personId);
    }
  });
  inFlightPersonVectorProcessing.set(personId, trackedPromise);
  return trackedPromise;
}

export async function processPendingAssetPersonReferenceVectors() {
  const staleBefore = new Date(Date.now() - PERSON_VECTOR_PROCESSING_STALE_MS);
  const recovered = await prisma.assetPerson.updateMany({
    where: {
      status: "processing",
      updatedAt: {
        lt: staleBefore,
      },
    },
    data: {
      status: "pending",
    },
  });

  const candidates = await prisma.assetPerson.findMany({
    where: {
      status: "pending",
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      teamId: true,
    },
    take: PERSON_VECTOR_RECOVERY_BATCH_SIZE,
  });

  let processing = 0;
  let skipped = 0;

  await Promise.all(
    candidates.map(async (candidate) => {
      const claimed = await prisma.assetPerson.updateMany({
        where: {
          id: candidate.id,
          teamId: candidate.teamId,
          status: "pending",
        },
        data: {
          status: "processing",
          processingError: null,
          processedAt: null,
        },
      });

      if (claimed.count === 0) {
        skipped += 1;
        return;
      }

      processing += 1;
      try {
        await processAssetPersonReferenceVectors({
          teamId: candidate.teamId,
          personId: candidate.id,
        });
      } catch (error) {
        console.error(`Failed to recover asset Person vectors (${candidate.id}):`, error);
      }
    }),
  );

  return {
    processing,
    recovered: recovered.count,
    skipped,
  };
}
