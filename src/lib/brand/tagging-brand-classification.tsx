import "server-only";

import { classifyBrandImageCrops, detectBrandLogoBoxes } from "@/lib/brand/logo-classification";
import {
  clampBox,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  normalizeRecommendedTags,
} from "@/lib/tagging/classification-image";
import { TaggingBrandRecommendation } from "@/prisma/client";
import prisma from "@/prisma/prisma";

const DEFAULT_LOGO_DETECTION_PROMPT = "logo . brand logo . emblem . trademark . label";

function buildLogoDetectionPromptName(name: string) {
  return name.trim();
}

async function fetchLogoDetectionPromptNames(teamId: number) {
  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true,
    },
  });

  const promptNames = Array.from(
    new Set(
      logos
        .map((logo) => buildLogoDetectionPromptName(logo.name))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  return [DEFAULT_LOGO_DETECTION_PROMPT, ...promptNames].join(" . ");
}

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
  const detectionLabelText = await fetchLogoDetectionPromptNames(teamId);
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

  if (!result.bestMatch || result.noConfidentMatch) {
    return {
      noConfidentMatch: true,
      bestMatch: result.bestMatch,
      recommendedTags: [],
    };
  }

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

  return {
    noConfidentMatch: false,
    bestMatch: result.bestMatch,
    recommendedTags: normalizeRecommendedTags(logoTags),
  };
}
