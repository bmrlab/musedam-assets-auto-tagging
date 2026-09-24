import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { groupProductDetectionBoxes } from "@/lib/product/detection-box-groups";
import { queryProductVectorPoints } from "@/lib/product/pgvector";
import { deduplicateProductMatches } from "@/lib/product/product-match-policy";
import type { ClassificationRemoteImageInput } from "@/lib/tagging/classification-image";
import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import prisma from "@/prisma/prisma";
import pLimit from "p-limit";
import { buildProductDetectionLabelText } from "./detection-prompt";
import { cropProductImageToDataUrl } from "./image-preparation";

const PRODUCT_IMAGE_VECTOR_QUERY_LIMIT = 20;
const PRODUCT_IMAGE_VECTOR_SCORE_THRESHOLD = 0.34;
const PRODUCT_DESCRIPTION_VECTOR_QUERY_LIMIT = 60;
const DESCRIPTION_SUPPORT_WEIGHT = 0.2;
const DESCRIPTION_ONLY_WEIGHT = 0.7;
// Bound work without dropping products from images containing many objects.
export const PRODUCT_CLASSIFICATION_CROP_CONCURRENCY = 4;

export type ProductDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type ProductTopMatch = {
  assetProductId: string;
  productName: string;
  productTypeId: string | null;
  productTypeName: string;
  description: string;
  generalCategory: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  detectionIndices?: number[];
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: Array<{
    id: string;
    assetTagId: number | null;
    tagPath: string[];
  }>;
};

export type ProductClassificationResult = {
  matches: Array<ProductTopMatch & { detectionIndices: number[] }>;
  rawDetections: ProductDetectionBox[];
  detections: Array<{
    detectionIndex: number;
    sourceDetectionIndices: number[];
    box: ProductDetectionBox;
    topMatches: ProductTopMatch[];
    bestMatch: ProductTopMatch | null;
    noConfidentMatch: boolean;
  }>;
  /** Compatibility summaries. Accepted products are always read from matches. */
  topMatches: ProductTopMatch[];
  bestMatch: ProductTopMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};

type DetectionServiceResponse = {
  detections?: Array<{
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
    score?: number;
    label?: string;
  }>;
  found?: boolean;
};

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function similarityToConfidence(similarity: number) {
  return clampConfidence(similarity * 100);
}

async function fetchProductDetectionPromptSources(teamId: number) {
  return prisma.assetProduct.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true,
      generalCategory: true,
    },
    take: 40,
  });
}

type CropAggregation = {
  imageSimilarity: number;
  descriptionSimilarity: number;
};

function computeCropScore(aggregation: CropAggregation) {
  if (aggregation.imageSimilarity > 0 && aggregation.descriptionSimilarity > 0) {
    return Math.min(
      0.99,
      aggregation.imageSimilarity + aggregation.descriptionSimilarity * DESCRIPTION_SUPPORT_WEIGHT,
    );
  }

  if (aggregation.imageSimilarity > 0) {
    return aggregation.imageSimilarity;
  }

  return aggregation.descriptionSimilarity * DESCRIPTION_ONLY_WEIGHT;
}

export async function detectProductFigureBoxes({
  teamId,
  imageBase64,
}: {
  teamId: number;
  imageBase64: string;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const detectionLabelText = await buildProductDetectionLabelText(
    await fetchProductDetectionPromptSources(teamId),
  );
  if (!detectionLabelText) {
    throw new Error("Product detection_label_text is empty after normalization");
  }
  const response = await fetch(`${baseUrl}/object_detection_llm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_base64: imageBase64,
      detection_label_text: detectionLabelText,
      detection_mode: "product_instances",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => null);
    console.error(
      `Product detection request failed (${response.status}) ${JSON.stringify(errorBody)}`,
    );
    throw new Error(`Product detection request failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => null)) as DetectionServiceResponse | null;

  return {
    detections:
      payload?.detections?.map((item) => ({
        xMin: item.x_min,
        yMin: item.y_min,
        xMax: item.x_max,
        yMax: item.y_max,
        score: item.score ?? 0,
        label: item.label ?? "product figure",
      })) ?? [],
    found: Boolean(payload?.found),
  };
}

/** Already prepared images still pass through grouping before embedding. */
export async function classifyProductImageCrops({
  teamId,
  crops,
}: {
  teamId: number;
  crops: Array<{
    box: ProductDetectionBox;
    image: string;
  }>;
}): Promise<ProductClassificationResult> {
  const rawDetections = crops.map((crop) => crop.box);
  const groups = groupProductDetectionBoxes(rawDetections);
  return classifyProductImageGroups({
    teamId,
    rawDetections,
    crops: groups.map((group) => ({ ...group, image: crops[group.detectionIndex].image })),
  });
}

/** Shared upload/automatic path: group once, then crop only the representative regions. */
export async function classifyProductImageRegions({
  teamId,
  imageInput,
  boxes,
}: {
  teamId: number;
  imageInput: ClassificationRemoteImageInput;
  boxes: ProductDetectionBox[];
}): Promise<ProductClassificationResult> {
  // Preserve the detector response for diagnostics. Intersect with the image
  // without expanding invalid/off-image boxes into artificial one-pixel crops.
  const rawDetections = boxes;
  const boundedBoxes = boxes.map((box) => {
    if (![box.xMin, box.yMin, box.xMax, box.yMax].every(Number.isFinite)) return box;
    return {
      ...box,
      xMin: Math.max(0, Math.min(imageInput.width, box.xMin)),
      yMin: Math.max(0, Math.min(imageInput.height, box.yMin)),
      xMax: Math.max(0, Math.min(imageInput.width, box.xMax)),
      yMax: Math.max(0, Math.min(imageInput.height, box.yMax)),
    };
  });
  const groups = groupProductDetectionBoxes(boundedBoxes);
  const prepareCrop = pLimit(PRODUCT_CLASSIFICATION_CROP_CONCURRENCY);
  const crops = await Promise.all(
    groups.map((group) =>
      prepareCrop(async () => ({
        ...group,
        image: await cropProductImageToDataUrl({
          imageInput,
          box: group.box,
        }),
      })),
    ),
  );
  return classifyProductImageGroups({ teamId, rawDetections, crops });
}

async function classifyProductImageGroups({
  teamId,
  rawDetections,
  crops,
}: {
  teamId: number;
  rawDetections: ProductDetectionBox[];
  crops: Array<{
    box: ProductDetectionBox;
    image: string;
    detectionIndex: number;
    sourceDetectionIndices: number[];
  }>;
}): Promise<ProductClassificationResult> {
  if (crops.length === 0) {
    return {
      matches: [],
      rawDetections,
      detections: [],
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const embeddings = await createJinaImageEmbeddings({
    images: crops.map((crop) => crop.image),
    task: "retrieval.query",
    // Keep the full detected object through Jina's square center crop.
    padToSquare: true,
  });
  if (embeddings.length !== crops.length) {
    throw new Error("Product classification embedding count mismatch");
  }

  const queryCrop = pLimit(PRODUCT_CLASSIFICATION_CROP_CONCURRENCY);
  const cropMatchGroups = await Promise.all(
    embeddings.map((vector, index) =>
      queryCrop(async () => {
        const [imageMatches, descriptionMatches] = await Promise.all([
          queryProductVectorPoints({
            teamId,
            vector,
            limit: PRODUCT_IMAGE_VECTOR_QUERY_LIMIT,
            scoreThreshold: PRODUCT_IMAGE_VECTOR_SCORE_THRESHOLD,
            sourceType: "image",
          }),
          queryProductVectorPoints({
            teamId,
            vector,
            limit: PRODUCT_DESCRIPTION_VECTOR_QUERY_LIMIT,
            sourceType: "description",
          }),
        ]);
        const cropMatches = new Map<string, CropAggregation>();
        for (const match of [...imageMatches, ...descriptionMatches]) {
          if (!Number.isFinite(match.score) || match.score <= 0) continue;
          const assetProductId = match.payload?.assetProductId;
          if (!assetProductId || typeof assetProductId !== "string") continue;

          const current = cropMatches.get(assetProductId) ?? {
            imageSimilarity: 0,
            descriptionSimilarity: 0,
          };
          if (match.payload?.sourceType === "description") {
            current.descriptionSimilarity = Math.max(current.descriptionSimilarity, match.score);
          } else {
            current.imageSimilarity = Math.max(current.imageSimilarity, match.score);
          }
          cropMatches.set(assetProductId, current);
        }
        return { index, cropMatches };
      }),
    ),
  );

  const matchedProductIds = Array.from(
    new Set(cropMatchGroups.flatMap(({ cropMatches }) => Array.from(cropMatches.keys()))),
  );
  const products =
    matchedProductIds.length > 0
      ? await prisma.assetProduct.findMany({
          where: {
            teamId,
            id: { in: matchedProductIds },
            enabled: true,
            status: "completed",
          },
          select: {
            id: true,
            name: true,
            productTypeId: true,
            productTypeName: true,
            description: true,
            generalCategory: true,
            tags: {
              orderBy: [{ sort: "asc" }, { id: "asc" }],
              select: { id: true, assetTagId: true, tagPath: true },
            },
          },
        })
      : [];
  const productMap = new Map(products.map((product) => [product.id, product]));

  const detections = cropMatchGroups.map(({ index, cropMatches }) => {
    const { box, detectionIndex, sourceDetectionIndices } = crops[index];
    const topMatches = Array.from(cropMatches.entries())
      .map(([assetProductId, stats]) => {
        const product = productMap.get(assetProductId);
        if (!product) return null;
        // Localization labels must not change identity rankings for identical pixels.
        const similarity = Math.min(0.99, computeCropScore(stats));
        return {
          assetProductId,
          productName: product.name,
          productTypeId: product.productTypeId,
          productTypeName: product.productTypeName,
          description: product.description,
          generalCategory: product.generalCategory,
          similarity,
          confidence: similarityToConfidence(similarity),
          detectionIndex,
          detectionIndices: sourceDetectionIndices,
          imageSimilarity: stats.imageSimilarity,
          descriptionSimilarity: stats.descriptionSimilarity,
          recommendedTags: product.tags.map((tag) => ({
            id: tag.id,
            assetTagId: tag.assetTagId,
            tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          })),
        } satisfies ProductTopMatch;
      })
      .filter((match): match is NonNullable<typeof match> => match !== null)
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          left.assetProductId.localeCompare(right.assetProductId),
      )
      .slice(0, 3);
    const bestMatch = topMatches[0] ?? null;
    return {
      detectionIndex,
      sourceDetectionIndices,
      box,
      topMatches,
      bestMatch,
      noConfidentMatch:
        !bestMatch || !meetsFeatureConfidenceThreshold("product", bestMatch.confidence),
    };
  });

  const matches = deduplicateProductMatches(
    detections.flatMap((detection) =>
      !detection.noConfidentMatch && detection.bestMatch ? [detection.bestMatch] : [],
    ),
  );
  const topMatches = deduplicateProductMatches(
    detections.flatMap((detection) => detection.topMatches),
  ).slice(0, 3);
  const bestMatch = topMatches[0] ?? null;
  return {
    rawDetections,
    detections,
    matches,
    topMatches,
    bestMatch,
    noConfidentMatch: matches.length === 0,
    winningDetectionIndex: bestMatch?.detectionIndex ?? null,
  };
}
