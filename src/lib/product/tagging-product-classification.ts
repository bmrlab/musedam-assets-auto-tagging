import "server-only";

import { classifyProductImageCrops, detectProductFigureBoxes } from "@/lib/product/product-classification";
import {
  clampBox,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingProductRecommendation } from "@/prisma/client";

export async function classifyAssetProductRecommendation({
  teamId,
  imageUrl,
}: {
  teamId: number;
  imageUrl?: string | null;
}): Promise<TaggingProductRecommendation | null> {
  if (!imageUrl) {
    return null;
  }

  const imageInput = await fetchRemoteImageInput(imageUrl, "Product classification");
  const detection = await detectProductFigureBoxes({
    teamId,
    imageUrl,
  });

  const candidateBoxes =
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")];
  const normalizedBoxes = candidateBoxes.map((box) => clampBox(box, imageInput));

  const crops = await Promise.all(
    normalizedBoxes.map(async (box) => ({
      box,
      image: await cropImageToDataUrl({
        imageDataUrl: imageInput.dataUrl,
        meta: imageInput,
        box,
      }),
    })),
  );

  const result = await classifyProductImageCrops({
    teamId,
    crops,
  });

  if (!result.bestMatch || result.noConfidentMatch) {
    return {
      noConfidentMatch: true,
      bestMatch: result.bestMatch
        ? {
            assetProductId: result.bestMatch.assetProductId,
            productName: result.bestMatch.productName,
            productTypeId: result.bestMatch.productTypeId,
            productTypeName: result.bestMatch.productTypeName,
            description: result.bestMatch.description,
            generalCategory: result.bestMatch.generalCategory,
            similarity: result.bestMatch.similarity,
            confidence: result.bestMatch.confidence,
            detectionIndex: result.bestMatch.detectionIndex,
            imageSimilarity: result.bestMatch.imageSimilarity,
            descriptionSimilarity: result.bestMatch.descriptionSimilarity,
          }
        : null,
      recommendedTags: [],
    };
  }

  return {
    noConfidentMatch: false,
    bestMatch: {
      assetProductId: result.bestMatch.assetProductId,
      productName: result.bestMatch.productName,
      productTypeId: result.bestMatch.productTypeId,
      productTypeName: result.bestMatch.productTypeName,
      description: result.bestMatch.description,
      generalCategory: result.bestMatch.generalCategory,
      similarity: result.bestMatch.similarity,
      confidence: result.bestMatch.confidence,
      detectionIndex: result.bestMatch.detectionIndex,
      imageSimilarity: result.bestMatch.imageSimilarity,
      descriptionSimilarity: result.bestMatch.descriptionSimilarity,
    },
    recommendedTags: normalizeRecommendedTags(result.bestMatch.recommendedTags),
  };
}
