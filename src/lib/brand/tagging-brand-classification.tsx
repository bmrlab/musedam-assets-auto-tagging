import "server-only";

import { classifyBrandImageCrops, detectBrandLogoBoxes } from "@/lib/brand/logo-classification";
import { fetchLogoDetectionLabelText } from "@/lib/brand/logo-detection-prompt";
import {
  clampBox,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingBrandRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function classifyAssetBrandRecommendation({
  teamId,
  imageUrl,
}: {
  teamId: number;
  imageUrl?: string | null;
}): Promise<TaggingBrandRecommendation | null> {
  if (!imageUrl) {
    return null;
  }

  // get detection boxes
  const detectionLabelText = await fetchLogoDetectionLabelText(teamId);
  const imageInput = await fetchRemoteImageInput(imageUrl, "brand classification");
  const detection = await detectBrandLogoBoxes({
    teamId,
    imageUrl,
    detectionLabelText,
  });

  const candidateBoxes =
    detection.detections.length > 0
      ? detection.detections
      : [getFallbackBox(imageInput, "whole image fallback")];
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
