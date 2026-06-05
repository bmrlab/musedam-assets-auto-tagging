import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import { getJinaConfig } from "@/lib/brand/env";
import { bufferToDataUrl } from "@/lib/brand/image";
import { createJinaImageEmbeddings, createJinaTextEmbeddings } from "@/lib/brand/jina";
import { getCachedSignedOssObjectUrl } from "@/lib/oss";
import type { OssUploadToken } from "@/lib/oss-upload-token";
import { translateTextToEnglish } from "@/lib/translation/service";
import prisma from "@/prisma/prisma";
import { generateObject, UserModelMessage } from "ai";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  deleteProductVectorPointsByProduct,
  ensureProductVectorCollection,
  setProductVectorPayloadByProduct,
  upsertProductVectorPoints,
} from "./qdrant";

const PRODUCT_PROCESSING_ERROR_CODES = {
  categoryPredictionFailed: "category_prediction_failed",
  embeddingCountMismatch: "embedding_count_mismatch",
  imageFetchFailed: "image_fetch_failed",
  productNotFound: "product_not_found",
  jinaRequestFailed: "jina_request_failed",
  noReferenceImages: "no_reference_images",
  unknown: "unknown",
  vectorStoreSyncFailed: "vector_store_sync_failed",
} as const;

type ProductProcessingErrorCode =
  (typeof PRODUCT_PROCESSING_ERROR_CODES)[keyof typeof PRODUCT_PROCESSING_ERROR_CODES];

const productCategorySchema = z.object({
  general_category: z.string().trim().min(1).max(100),
});

function createProcessingError(code: ProductProcessingErrorCode, cause?: unknown) {
  const error = new Error(code) as Error & {
    productProcessingErrorCode: ProductProcessingErrorCode;
    cause?: unknown;
  };
  error.productProcessingErrorCode = code;
  error.cause = cause;
  return error;
}

function getProcessingErrorCode(error: unknown): ProductProcessingErrorCode {
  if (
    error instanceof Error &&
    "productProcessingErrorCode" in error &&
    typeof error.productProcessingErrorCode === "string"
  ) {
    return error.productProcessingErrorCode as ProductProcessingErrorCode;
  }

  const message = error instanceof Error ? error.message : "";

  if (message.includes("Jina embeddings request failed")) {
    return PRODUCT_PROCESSING_ERROR_CODES.jinaRequestFailed;
  }

  if (message.includes("Qdrant request failed")) {
    return PRODUCT_PROCESSING_ERROR_CODES.vectorStoreSyncFailed;
  }

  return PRODUCT_PROCESSING_ERROR_CODES.unknown;
}

async function fetchImageAsDataUrl(
  image: {
    objectKey: string;
    ossBucket: string;
    ossEndpoint: string;
    ossRegion: string;
    mimeType: string;
  },
  uploadToken: OssUploadToken,
) {
  const { signedUrl } = await getCachedSignedOssObjectUrl({
    objectKey: image.objectKey,
    location: {
      ossBucket: image.ossBucket,
      ossEndpoint: image.ossEndpoint,
      ossRegion: image.ossRegion,
    },
    token: uploadToken,
  });
  const response = await fetch(signedUrl);

  if (!response.ok) {
    const error = createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.imageFetchFailed);
    error.cause = new Error(`OSS image fetch failed (${response.status})`);
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return bufferToDataUrl(buffer, image.mimeType);
}

function getProductCategoryPredictModel(): LLMModelName {
  return (process.env.PRODUCT_CATEGORY_PREDICT_MODEL?.trim() || "gpt-5-mini") as LLMModelName;
}

function normalizeGeneralCategory(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return normalized || "product";
}

function buildProductDescriptionText(product: {
  name: string;
  productTypeName: string;
  description: string;
  notes: string;
}) {
  return [
    `Product name: ${product.name}`,
    `Product type: ${product.productTypeName}`,
    product.description ? `Core visual features: ${product.description}` : "",
    product.notes ? `Notes: ${product.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function predictProductGeneralCategory({
  product,
  imageInputs,
}: {
  product: {
    name: string;
    productTypeName: string;
    description: string;
    notes: string;
  };
  imageInputs: string[];
}) {
  try {
    const llmInputText = `Classify the product's general category from the reference images and user-provided text.
      Return JSON only with one field: general_category.

      Rules:
      - general_category must be a short, lowercase English common noun or noun phrase.
      - Do not include brand names, model names, SKU codes, colors, or marketing series.
      - Prefer concrete product categories such as "phone", "keyboard", "headphones", "watch", "bottle", "shoe", "bag", "snack", "cosmetics".
      - If uncertain, choose the nearest visible product category.

      User input:
      ${buildProductDescriptionText(product)}`;
    const content: UserModelMessage["content"] = [
      {
        type: "text",
        text: llmInputText,
      },
      ...imageInputs.slice(0, 4).map((image) => ({
        type: "image" as const,
        image,
      })),
    ];

    const result = await generateObject({
      model: llm(getProductCategoryPredictModel()),
      schemaName: "ProductGeneralCategory",
      schemaDescription:
        'Return only JSON with one string field "general_category", for example {"general_category":"phone"}.',
      schema: productCategorySchema,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      temperature: 0,
    });

    return normalizeGeneralCategory(result.object.general_category);
  } catch (error) {
    throw createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.categoryPredictionFailed, error);
  }
}

export async function markAssetProductVectorsProcessing({
  teamId,
  productId,
  enabled,
}: {
  teamId: number;
  productId: string;
  enabled: boolean;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.assetProduct.update({
      where: {
        id: productId,
      },
      data: {
        status: "processing",
        processingError: null,
        processedAt: null,
      },
    });

    await tx.assetProductImage.updateMany({
      where: {
        assetProductId: productId,
      },
      data: {
        qdrantPointId: null,
        embeddingModel: null,
        embeddedAt: null,
      },
    });
  });

  await setProductVectorPayloadByProduct({
    teamId,
    assetProductId: productId,
    payload: {
      enabled,
      status: "processing",
    },
  }).catch((error) => {
    console.warn("Failed to mark Product vector payload as processing:", error);
  });
}

export async function processAssetProductReferenceVectors({
  teamId,
  productId,
  uploadToken,
}: {
  teamId: number;
  productId: string;
  uploadToken: OssUploadToken;
}) {
  try {
    const product = await prisma.assetProduct.findFirst({
      where: {
        id: productId,
        teamId,
      },
      include: {
        images: {
          orderBy: [{ sort: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!product) {
      throw createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.productNotFound);
    }

    if (product.images.length === 0) {
      throw createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.noReferenceImages);
    }

    const imageInputs = await Promise.all(
      product.images.map((image) => fetchImageAsDataUrl(image, uploadToken)),
    );
    const imageEmbeddings = await createJinaImageEmbeddings({
      images: imageInputs,
    });

    if (imageEmbeddings.length !== product.images.length) {
      throw createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.embeddingCountMismatch);
    }

    const normalizedDescription = product.description.trim();
    const descriptionEmbeddings = normalizedDescription
      ? await createJinaTextEmbeddings({
          texts: [await translateTextToEnglish(normalizedDescription)],
        })
      : [];

    const vectorSize = imageEmbeddings[0]?.length ?? descriptionEmbeddings[0]?.length;
    if (!vectorSize) {
      throw createProcessingError(PRODUCT_PROCESSING_ERROR_CODES.embeddingCountMismatch);
    }

    const generalCategory = await predictProductGeneralCategory({
      product,
      imageInputs,
    });

    await ensureProductVectorCollection(vectorSize);
    await deleteProductVectorPointsByProduct({
      teamId,
      assetProductId: product.id,
    });

    const imagePointIds = product.images.map(() => randomUUID());
    const vectorPoints: Array<{
      id: string;
      vector: number[];
      payload: {
        teamId: number;
        assetProductId: string;
        assetProductImageId: string | null;
        productTypeId: string | null;
        generalCategory: string;
        enabled: boolean;
        status: "completed";
        sourceType: "image" | "description";
      };
    }> = product.images.map((image, index) => ({
      id: imagePointIds[index],
      vector: imageEmbeddings[index],
      payload: {
        teamId,
        assetProductId: product.id,
        assetProductImageId: image.id,
        productTypeId: product.productTypeId,
        generalCategory,
        enabled: product.enabled,
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
          assetProductId: product.id,
          assetProductImageId: null,
          productTypeId: product.productTypeId,
          generalCategory,
          enabled: product.enabled,
          status: "completed" as const,
          sourceType: "description" as const,
        },
      });
    }

    await upsertProductVectorPoints(vectorPoints);

    const processedAt = new Date();
    const embeddingModel = getJinaConfig().model;

    await prisma.$transaction(async (tx) => {
      await tx.assetProduct.update({
        where: {
          id: product.id,
        },
        data: {
          status: "completed",
          processingError: null,
          processedAt,
          generalCategory,
        },
      });

      await Promise.all(
        product.images.map((image, index) =>
          tx.assetProductImage.update({
            where: {
              id: image.id,
            },
            data: {
              qdrantPointId: imagePointIds[index],
              embeddingModel,
              embeddedAt: processedAt,
            },
          }),
        ),
      );
    });
  } catch (error) {
    const message = getProcessingErrorCode(error);

    await prisma.assetProduct
      .update({
        where: {
          id: productId,
        },
        data: {
          status: "failed",
          processingError: message,
        },
      })
      .catch(() => undefined);

    await setProductVectorPayloadByProduct({
      teamId,
      assetProductId: productId,
      payload: {
        status: "failed",
      },
    }).catch(() => undefined);

    throw error;
  }
}
