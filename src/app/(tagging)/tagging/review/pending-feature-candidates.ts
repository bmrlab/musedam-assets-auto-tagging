import { getBrandMatches, getIpMatches } from "@/lib/feature-decision/match-policy";
import { getProductMatches } from "@/lib/product/product-match-policy";
import {
  meetsFeatureConfidenceThreshold,
  type FeatureThresholds,
} from "@/lib/tagging/feature-confidence";
import type { TaggingQueueItemResult } from "@/prisma/client";
import { featureKey, type ReviewFeature } from "./feature-review";

export type PendingFeatureCandidate = {
  queueItemId: number;
  key: string;
  name: string;
  confidence: number;
  feature: ReviewFeature;
};

/** High scoring unresolved predictions are informational; they never enter applied matches. */
export function pendingFeatureCandidates(
  queueItemId: number,
  value: unknown,
  library: Map<string, ReviewFeature>,
  thresholds: FeatureThresholds,
): PendingFeatureCandidate[] {
  const result = (value ?? {}) as TaggingQueueItemResult;
  if (result.featureDecision?.decision.status !== "completed") return [];
  const accepted = new Set([
    ...getBrandMatches(result.brandRecommendation).map((match) => `logo:${match.assetLogoId}`),
    ...getIpMatches(result.ipRecommendation).map((match) => `ip:${match.assetIpId}`),
    ...getProductMatches(result.productRecommendation).map(
      (match) => `product:${match.assetProductId}`,
    ),
  ]);
  return (result.featureDecision.decision.result?.matches ?? []).flatMap((match) => {
    const [kind, id] = match.candidateId.split(":");
    const type =
      kind === "logo" ? "brand" : kind === "ip" ? "ip" : kind === "product" ? "product" : null;
    if (
      !type ||
      accepted.has(match.candidateId) ||
      !meetsFeatureConfidenceThreshold(type, match.confidence, thresholds[type])
    )
      return [];
    const feature = library.get(featureKey(type, id));
    const reasons = [
      ...match.conflicts,
      ...(match.specificityLimit?.trim() ? [match.specificityLimit] : []),
    ];
    if (!feature || !reasons.length) return [];
    return [
      {
        queueItemId,
        key: match.candidateId,
        name: feature.name,
        confidence: match.confidence,
        feature,
      },
    ];
  });
}
