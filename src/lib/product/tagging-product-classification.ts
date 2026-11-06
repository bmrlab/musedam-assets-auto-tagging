import { classifyAssetFeatures, getFeatureDecisionMode } from "@/lib/feature-decision/classify";
import { buildFeatureRecommendations } from "@/lib/feature-decision/recommendations";
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
import { getFeatureThresholds } from "@/lib/tagging/feature-threshold-settings";
import prisma from "@/prisma/prisma";

export async function classifyAssetProductRecommendation({
  teamId,
  imageUrl,
  imageInput: providedImageInput,
  fileName,
  folderPath,
}: {
  teamId: number;
  imageUrl?: string | null;
  imageInput?: ClassificationRemoteImageInput | null;
  fileName?: string;
  folderPath?: string;
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
    (await fetchRemoteImageInput(imageUrl as string, "Product classification", {
      preserveOriginal: true,
    }));
  if (getFeatureDecisionMode() === "llm") {
    const result = await classifyAssetFeatures({
      teamId,
      imageInput,
      fileName,
      folderPath,
      enabledTypes: ["product"],
    });
    return (await buildFeatureRecommendations(result)).productRecommendation;
  }
  const confidenceThreshold = (await getFeatureThresholds(teamId)).product;
  const detection = await detectProductFigureBoxes({
    teamId,
    imageInput,
  });

  const candidateBoxes =
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")];
  const result = await classifyProductImageRegions({
    teamId,
    imageInput,
    boxes: candidateBoxes,
    confidenceThreshold,
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
    confidenceThreshold,
    decisionSource: "legacy",
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
