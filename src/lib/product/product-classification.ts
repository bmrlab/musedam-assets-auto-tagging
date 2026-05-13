import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";
import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { queryProductVectorPoints } from "@/lib/product/qdrant";
import prisma from "@/prisma/prisma";

const PRODUCT_IMAGE_VECTOR_QUERY_LIMIT = 20;
const PRODUCT_IMAGE_VECTOR_SCORE_THRESHOLD = 0.34;
const PRODUCT_DESCRIPTION_VECTOR_QUERY_LIMIT = 60;
const DESCRIPTION_SUPPORT_WEIGHT = 0.2;
const DESCRIPTION_ONLY_WEIGHT = 0.7;
const MULTI_CROP_SUPPORT_BONUS = 0.02;
const MAX_SUPPORT_BONUS = 0.06;
const SUPPORTING_CROP_THRESHOLD = 0.46;
const CATEGORY_ALIGNMENT_BONUS = 0.04;

const CONFIDENT_WINNER_HIGH_SIMILARITY = 0.78;
const CONFIDENT_WINNER_LOW_SIMILARITY = 0.62;
const CONFIDENT_WINNER_MIN_MARGIN = 0.05;

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
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: Array<{
    id: string;
    assetTagId: number | null;
    tagPath: string[];
  }>;
};

export type ProductClassificationResult = {
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

function isConfidentWinner(topMatches: ProductTopMatch[]) {
  const best = topMatches[0];
  if (!best) {
    return false;
  }

  const secondSimilarity = topMatches[1]?.similarity ?? 0;
  const margin = best.similarity - secondSimilarity;

  if (best.similarity >= CONFIDENT_WINNER_HIGH_SIMILARITY) {
    return true;
  }

  if (best.similarity < CONFIDENT_WINNER_LOW_SIMILARITY) {
    return false;
  }

  return margin >= CONFIDENT_WINNER_MIN_MARGIN;
}

function normalizeDetectionPromptTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[。！!？?]/g, " ")
    .trim();
}

function categoriesAlign(category: string, label: string) {
  const normalizedCategory = normalizeDetectionPromptTerm(category);
  const normalizedLabel = normalizeDetectionPromptTerm(label);

  if (!normalizedCategory || !normalizedLabel) {
    return false;
  }

  return (
    normalizedLabel.includes(normalizedCategory) || normalizedCategory.includes(normalizedLabel)
  );
}

async function fetchProductDetectionPromptNames(teamId: number) {
  const products = await prisma.assetProduct.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      generalCategory: true,
    },
    take: 40,
  });

  const promptNames = Array.from(
    new Set(
      products
        .map((product) => normalizeDetectionPromptTerm(product.generalCategory))
        .filter(Boolean),
    ),
  );

  return promptNames.length > 0 ? promptNames.join(" . ") : "product";
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
  imageUrl,
}: {
  teamId: number;
  imageUrl: string;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const detectionLabelText = await fetchProductDetectionPromptNames(teamId);
  const response = await fetch(`${baseUrl}/object_detection_groundingDINO`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      detection_label_text: detectionLabelText,
    }),
  });

  const payload = (await response.json().catch(() => null)) as DetectionServiceResponse | null;
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Product detection request failed (${response.status}) ${JSON.stringify(errorBody)}`,
    );
    throw new Error(`Product detection request failed (${response.status})`);
  }

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
  if (crops.length === 0) {
    return {
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const embeddings = await createJinaImageEmbeddings({
    images: crops.map((crop) => crop.image),
    task: "retrieval.query",
  });

  const rankedByProduct = new Map<
    string,
    {
      similarity: number;
      detectionIndex: number;
      imageSimilarity: number;
      descriptionSimilarity: number;
      supportingDetections: Set<number>;
    }
  >();

  for (let index = 0; index < embeddings.length; index += 1) {
    const imageMatches = await queryProductVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: PRODUCT_IMAGE_VECTOR_QUERY_LIMIT,
      scoreThreshold: PRODUCT_IMAGE_VECTOR_SCORE_THRESHOLD,
      sourceType: "image",
    });
    const descriptionMatches = await queryProductVectorPoints({
      teamId,
      vector: embeddings[index],
      limit: PRODUCT_DESCRIPTION_VECTOR_QUERY_LIMIT,
      sourceType: "description",
    });
    const matches = [...imageMatches, ...descriptionMatches];

    const cropMatches = new Map<string, CropAggregation>();

    for (const match of matches) {
      if (match.score <= 0) {
        continue;
      }

      const assetProductId = match.payload?.assetProductId;
      if (!assetProductId || typeof assetProductId !== "string") {
        continue;
      }

      const sourceType = match.payload?.sourceType === "description" ? "description" : "image";
      const current = cropMatches.get(assetProductId) ?? {
        imageSimilarity: 0,
        descriptionSimilarity: 0,
      };

      if (sourceType === "description") {
        current.descriptionSimilarity = Math.max(current.descriptionSimilarity, match.score);
      } else {
        current.imageSimilarity = Math.max(current.imageSimilarity, match.score);
      }

      cropMatches.set(assetProductId, current);
    }

    for (const [assetProductId, aggregation] of cropMatches.entries()) {
      const cropScore = computeCropScore(aggregation);
      const current = rankedByProduct.get(assetProductId) ?? {
        similarity: 0,
        detectionIndex: index,
        imageSimilarity: 0,
        descriptionSimilarity: 0,
        supportingDetections: new Set<number>(),
      };

      if (cropScore >= SUPPORTING_CROP_THRESHOLD) {
        current.supportingDetections.add(index);
      }

      if (cropScore > current.similarity) {
        current.similarity = cropScore;
        current.detectionIndex = index;
        current.imageSimilarity = aggregation.imageSimilarity;
        current.descriptionSimilarity = aggregation.descriptionSimilarity;
      }

      rankedByProduct.set(assetProductId, current);
    }
  }

  const matchedProductIds = Array.from(rankedByProduct.keys());
  if (matchedProductIds.length === 0) {
    return {
      topMatches: [],
      bestMatch: null,
      noConfidentMatch: true,
      winningDetectionIndex: null,
    };
  }

  const products = await prisma.assetProduct.findMany({
    where: {
      teamId,
      id: {
        in: matchedProductIds,
      },
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
        select: {
          id: true,
          assetTagId: true,
          tagPath: true,
        },
      },
    },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));
  const topMatches = matchedProductIds
    .map((assetProductId) => {
      const stats = rankedByProduct.get(assetProductId);
      const product = productMap.get(assetProductId);

      if (!stats || !product) {
        return null;
      }

      const supportBonus = Math.min(
        MAX_SUPPORT_BONUS,
        Math.max(0, stats.supportingDetections.size - 1) * MULTI_CROP_SUPPORT_BONUS,
      );
      const boxLabel = crops[stats.detectionIndex]?.box.label ?? "";
      const categoryBonus = categoriesAlign(product.generalCategory, boxLabel)
        ? CATEGORY_ALIGNMENT_BONUS
        : 0;
      const similarity = Math.min(0.99, stats.similarity + supportBonus + categoryBonus);

      return {
        assetProductId,
        productName: product.name,
        productTypeId: product.productTypeId,
        productTypeName: product.productTypeName,
        description: product.description,
        generalCategory: product.generalCategory,
        similarity,
        confidence: similarityToConfidence(similarity),
        detectionIndex: stats.detectionIndex,
        imageSimilarity: stats.imageSimilarity,
        descriptionSimilarity: stats.descriptionSimilarity,
        recommendedTags: product.tags.map((tag) => ({
          id: tag.id,
          assetTagId: tag.assetTagId,
          tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
        })),
      } satisfies ProductTopMatch;
    })
    .filter((match): match is ProductTopMatch => Boolean(match))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3);

  const confident = isConfidentWinner(topMatches);
  const bestMatch = topMatches[0] ?? null;

  return {
    topMatches,
    bestMatch,
    noConfidentMatch: !confident,
    winningDetectionIndex: bestMatch?.detectionIndex ?? null,
  };
}
