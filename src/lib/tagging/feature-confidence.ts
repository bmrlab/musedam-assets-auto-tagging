export const FEATURE_CONFIDENCE_MIN = {
  brand: 85,
  ip: 85,
  product: 85,
  person: 60,
} as const;

export type FeatureType = keyof typeof FEATURE_CONFIDENCE_MIN;

const BLUE_TONE_CLASS = "text-primary-6 bg-primary-1 border-[#A6C1FF]";
const GREEN_TONE_CLASS =
  "text-[#52C41A] bg-[#F6FFED] border-[#95DE64] dark:text-success-6 dark:bg-success-1 dark:border-success-3";
const ORANGE_TONE_CLASS =
  "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069] dark:text-warning-6 dark:bg-warning-1 dark:border-warning-4";

export function normalizeFeatureConfidence(confidence: number | null | undefined): number {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(confidence)));
}

export function meetsFeatureConfidenceThreshold(
  featureType: FeatureType,
  confidence: number | null | undefined,
): boolean {
  return normalizeFeatureConfidence(confidence) >= FEATURE_CONFIDENCE_MIN[featureType];
}

/** 95–100 blue, 90–95 green, below 90 orange (person: 60–90; brand/ip/product: 85–90). */
export function getFeatureConfidenceToneClass(confidence: number): string {
  if (confidence >= 95) {
    return BLUE_TONE_CLASS;
  }

  if (confidence >= 90) {
    return GREEN_TONE_CLASS;
  }

  return ORANGE_TONE_CLASS;
}
