import "server-only";

import { classifyIpImageCrops, detectIpFigureBoxes } from "@/lib/ip/ip-classification";
import {
  clampBox,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingIpRecommendation } from "@/prisma/client";

export async function classifyAssetIpRecommendation({
  teamId,
  imageUrl,
}: {
  teamId: number;
  imageUrl?: string | null;
}): Promise<TaggingIpRecommendation | null> {
  if (!imageUrl) {
    return null;
  }

  const imageInput = await fetchRemoteImageInput(imageUrl, "IP classification");
  const detection = await detectIpFigureBoxes({
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

  const result = await classifyIpImageCrops({
    teamId,
    crops,
  });

  if (!result.bestMatch || result.noConfidentMatch) {
    return {
      noConfidentMatch: true,
      bestMatch: result.bestMatch
        ? {
            assetIpId: result.bestMatch.assetIpId,
            ipName: result.bestMatch.ipName,
            ipTypeId: result.bestMatch.ipTypeId,
            ipTypeName: result.bestMatch.ipTypeName,
            description: result.bestMatch.description,
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
      assetIpId: result.bestMatch.assetIpId,
      ipName: result.bestMatch.ipName,
      ipTypeId: result.bestMatch.ipTypeId,
      ipTypeName: result.bestMatch.ipTypeName,
      description: result.bestMatch.description,
      similarity: result.bestMatch.similarity,
      confidence: result.bestMatch.confidence,
      detectionIndex: result.bestMatch.detectionIndex,
      imageSimilarity: result.bestMatch.imageSimilarity,
      descriptionSimilarity: result.bestMatch.descriptionSimilarity,
    },
    recommendedTags: normalizeRecommendedTags(result.bestMatch.recommendedTags),
  };
}
