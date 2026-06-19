import "server-only";

import { classifyIpImageCrops, detectIpFigureBoxes } from "@/lib/ip/ip-classification";
import {
  clampBox,
  ClassificationRemoteImageInput,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  MAX_DETECTION_CROPS,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingIpRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function classifyAssetIpRecommendation({
  teamId,
  imageUrl,
  imageInput: providedImageInput,
}: {
  teamId: number;
  imageUrl?: string | null;
  imageInput?: ClassificationRemoteImageInput | null;
}): Promise<TaggingIpRecommendation | null> {
  if (!providedImageInput && !imageUrl) {
    return null;
  }

  // 空库守卫：没有任何可用的 IP 向量时直接返回
  const referenceCount = await prisma.ipVector.count({
    where: { teamId, enabled: true, status: "completed" },
  });
  if (referenceCount === 0) {
    return null;
  }

  const imageInput =
    providedImageInput ?? (await fetchRemoteImageInput(imageUrl as string, "IP classification"));
  const detection = await detectIpFigureBoxes({
    teamId,
    imageBase64: imageInput.dataUrl,
  });

  const candidateBoxes = (
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")]
  ).slice(0, MAX_DETECTION_CROPS);
  const normalizedBoxes = candidateBoxes.map((box) => clampBox(box, imageInput));

  const crops = await Promise.all(
    normalizedBoxes.map(async (box) => ({
      box,
      image: await cropImageToDataUrl({
        imageDataUrl: imageInput.dataUrl,
        imageBuffer: imageInput.buffer,
        sourceMimeType: imageInput.mimeType,
        meta: imageInput,
        box,
      }),
    })),
  );

  const result = await classifyIpImageCrops({
    teamId,
    crops,
  });

  if (!result.bestMatch) {
    return {
      noConfidentMatch: true,
      bestMatch: null,
      recommendedTags: [],
    };
  }

  const normalizedTags = normalizeRecommendedTags(result.bestMatch.recommendedTags);

  return {
    noConfidentMatch: result.noConfidentMatch ?? false,
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
      recommendedTags: normalizedTags,
    },
    recommendedTags: normalizedTags,
  };
}
