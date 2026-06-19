import "server-only";

import { classifyBrandImageCrops, detectBrandLogoBoxes } from "@/lib/brand/logo-classification";
import { fetchLogoDetectionLabelText } from "@/lib/brand/logo-detection-prompt";
import {
  clampBox,
  ClassificationRemoteImageInput,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  MAX_DETECTION_CROPS,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingBrandRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function classifyAssetBrandRecommendation({
  teamId,
  imageUrl,
  imageInput: providedImageInput,
}: {
  teamId: number;
  imageUrl?: string | null;
  imageInput?: ClassificationRemoteImageInput | null;
}): Promise<TaggingBrandRecommendation | null> {
  if (!providedImageInput && !imageUrl) {
    return null;
  }

  // 空库守卫：没有任何可用的 logo 向量时直接返回，避免无谓的下载/检测/编码
  const referenceCount = await prisma.logoVector.count({
    where: { teamId, enabled: true, status: "completed" },
  });
  if (referenceCount === 0) {
    return null;
  }

  // get detection boxes
  const detectionLabelText = await fetchLogoDetectionLabelText(teamId);
  const imageInput =
    providedImageInput ?? (await fetchRemoteImageInput(imageUrl as string, "brand classification"));
  const detection = await detectBrandLogoBoxes({
    teamId,
    imageBase64: imageInput.dataUrl,
    detectionLabelText,
  });

  const candidateBoxes = (
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")]
  ).slice(0, MAX_DETECTION_CROPS);
  const normalizedBoxes = candidateBoxes.map((box) => clampBox(box, imageInput));

  // get cropped images from boxes
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

  // classify cropped images and score each logo class
  const result = await classifyBrandImageCrops({
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

  // Fetch logo tags regardless of confidence level
  const logoTags = await prisma.assetLogoTag.findMany({
    where: {
      assetLogoId: result.bestMatch.assetLogoId,
      assetTagId: {
        not: null,
      },
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
    select: {
      assetTagId: true,
      tagPath: true,
    },
  });

  const normalizedTags = normalizeRecommendedTags(logoTags);

  return {
    noConfidentMatch: result.noConfidentMatch ?? false,
    bestMatch: {
      ...result.bestMatch,
      recommendedTags: normalizedTags,
    },
    recommendedTags: normalizedTags,
  };
}
