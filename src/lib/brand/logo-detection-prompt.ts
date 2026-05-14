import "server-only";

import { translateDetectionTermsToEnglish } from "@/lib/translation/service";
import prisma from "@/prisma/prisma";

const DEFAULT_LOGO_DETECTION_PROMPT = "logo . brand logo . emblem . trademark . label";

function normalizeLogoDetectionPromptTerm(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function fetchLogoDetectionLabelText(teamId: number): Promise<string> {
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

  const promptNames = Array.from(new Set(logos.map((logo) => logo.name.trim()).filter(Boolean)));

  const translated = await translateDetectionTermsToEnglish(promptNames);
  const translatedNames = translated
    .map((value) => normalizeLogoDetectionPromptTerm(value))
    .filter(Boolean);
  return [DEFAULT_LOGO_DETECTION_PROMPT, ...translatedNames].join(" . ");
}
