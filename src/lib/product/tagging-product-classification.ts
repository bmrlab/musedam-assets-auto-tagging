import "server-only";

import {
  classifyProductImageRegions,
  detectProductFigureBoxes,
  ProductTopMatch,
} from "@/lib/product/product-classification";
import {
  ClassificationRemoteImageInput,
  fetchRemoteImageInput,
  getFallbackBox,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingProductRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function classifyAssetProductRecommendation({
  teamId,
  imageUrl,
  imageInput: providedImageInput,
}: {
  teamId: number;
  imageUrl?: string | null;
  imageInput?: ClassificationRemoteImageInput | null;
}): Promise<TaggingProductRecommendation | null> {
  if (!providedImageInput && !imageUrl) {
    return null;
  }

  // 空库守卫：没有任何可用的商品向量时直接返回
  const referenceCount = await prisma.productVector.count({
    where: { teamId, enabled: true, status: "completed" },
  });
  if (referenceCount === 0) {
    return null;
  }

  const imageInput =
    providedImageInput ??
    (await fetchRemoteImageInput(imageUrl as string, "Product classification"));
  const detection = await detectProductFigureBoxes({
    teamId,
    imageBase64: imageInput.dataUrl,
  });

  const candidateBoxes =
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")];
  const result = await classifyProductImageRegions({
    teamId,
    imageInput,
    boxes: candidateBoxes,
  });

  const normalizeMatch = <T extends ProductTopMatch>(match: T) => ({
    ...match,
    recommendedTags: normalizeRecommendedTags(match.recommendedTags),
  });
  const matches = result.matches.map(normalizeMatch);
  const recommendedTags = normalizeRecommendedTags(
    result.matches.flatMap((match) => match.recommendedTags),
  );

  return {
    noConfidentMatch: matches.length === 0,
    rawDetections: result.rawDetections,
    matches,
    detections: result.detections.map((detection) => ({
      ...detection,
      topMatches: detection.topMatches.map(normalizeMatch),
      bestMatch: detection.bestMatch ? normalizeMatch(detection.bestMatch) : null,
    })),
    bestMatch: result.bestMatch ? normalizeMatch(result.bestMatch) : null,
    recommendedTags,
  };
}
