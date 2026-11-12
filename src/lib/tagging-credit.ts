import { isVideoAssetExtension } from "./feature-library";

export const TAGGING_CREDIT_PRICING_VERSION = "video-duration-v1";
export const VIDEO_CREDIT_INTERVAL_MS = 2_000;
export const MAX_VIDEO_CREDIT_FRAMES = 8;

type CreditAsset = { name?: string; extra?: unknown };

/** Resolve the independent team setting; the legacy setting is image-only. */
export function getAssetFeatureImageMode(
  settings: { featureImageMode?: boolean; featureVideoImageMode?: boolean },
  asset?: CreditAsset,
) {
  const extra = (asset?.extra ?? {}) as { extension?: unknown };
  const extension =
    typeof extra.extension === "string" && extra.extension.trim()
      ? extra.extension
      : asset?.name?.split(".").at(-1);
  return isVideoAssetExtension(extension)
    ? settings.featureVideoImageMode === true
    : settings.featureImageMode === true;
}

/** Pricing frames are fixed from duration, independent of decoding, deduplication or retries. */
export function getTaggingCreditQuote(featureImageMode: boolean, asset?: CreditAsset) {
  const extra = (asset?.extra ?? {}) as { extension?: unknown; duration?: unknown };
  const extension =
    typeof extra.extension === "string" && extra.extension.trim()
      ? extra.extension
      : asset?.name?.split(".").at(-1);
  const isVideo = isVideoAssetExtension(extension);
  const durationMs =
    isVideo &&
    typeof extra.duration === "number" &&
    Number.isFinite(extra.duration) &&
    extra.duration > 0
      ? extra.duration
      : null;
  const creditFrameCount =
    durationMs === null
      ? 1
      : Math.min(MAX_VIDEO_CREDIT_FRAMES, Math.ceil(durationMs / VIDEO_CREDIT_INTERVAL_MS));
  return {
    creditPricingVersion: TAGGING_CREDIT_PRICING_VERSION,
    creditFrameCount,
    creditDurationMs: durationMs,
    creditCost: creditFrameCount * (featureImageMode ? 2 : 1),
  };
}

export function getTaggingCreditCost(featureImageMode: boolean, asset?: CreditAsset): number {
  return getTaggingCreditQuote(featureImageMode, asset).creditCost;
}
