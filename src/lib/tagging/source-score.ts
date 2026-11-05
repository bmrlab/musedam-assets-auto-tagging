import type { SourceWeights, TagWithScore } from "@/app/(tagging)/types";

const SCORING_WEIGHTS: Record<keyof TagWithScore["confidenceBySources"], number> = {
  basicInfo: 0.7,
  materializedPath: 0.6,
  contentAnalysis: 0.85,
  tagKeywords: 0.95,
};

export function calculateMultiSourceScore(
  confidenceBySources: TagWithScore["confidenceBySources"],
  sourceWeights?: Partial<SourceWeights>,
): number {
  const dampingFactor = 0.8;
  let remaining = 1;
  let maxWeighted = 0;

  (
    Object.entries(confidenceBySources) as [keyof TagWithScore["confidenceBySources"], number][]
  ).forEach(([source, confidence]) => {
    if (confidence !== undefined && confidence !== null) {
      // 团队自定义权重为倍数：越大指数越小，该来源的置信度被放大得越多；1 即保持默认
      const userWeight = sourceWeights?.[source];
      const weight =
        userWeight && userWeight > 0
          ? SCORING_WEIGHTS[source] / userWeight
          : SCORING_WEIGHTS[source];
      const enhanced = Math.pow(confidence, weight);
      maxWeighted = Math.max(maxWeighted, enhanced);
      remaining *= 1 - enhanced * dampingFactor;
    }
  });

  const rawScore = 1 - remaining;
  return Math.max(rawScore, maxWeighted);
}
