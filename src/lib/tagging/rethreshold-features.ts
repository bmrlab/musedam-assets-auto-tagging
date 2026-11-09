import { getBrandMatches, getIpMatches, getScoredFeaturePredictions } from "@/lib/feature-decision/match-policy";
import { isReviewablePersonFace } from "@/lib/person/person-match-policy";
import { getProductMatches, selectProductRegionWinners } from "@/lib/product/product-match-policy";
import type { TaggingQueueItemResult } from "@/prisma/client";
import { meetsFeatureConfidenceThreshold, type FeatureThresholds } from "./feature-confidence";

/** Reuse final model decisions, never promote raw retrieval similarity or rejected alternatives. */
export function rethresholdFeatures(
  value: unknown,
  thresholds: FeatureThresholds,
): TaggingQueueItemResult {
  const source = (value ?? {}) as TaggingQueueItemResult;
  const output = { ...source };
  const diagnostics = source.featureDecision;
  const hasDecisions = diagnostics?.decision.status === "completed";
  const decisions = getScoredFeaturePredictions(diagnostics);
  // Metadata placeholders are hydrated from the current team-owned feature library before review.
  const common = {
    similarity: 0,
    detectionIndex: -1,
    imageSimilarity: 0,
    descriptionSimilarity: 0,
    description: "",
    recommendedTags: [],
  };
  if (source.brandRecommendation) {
    const old = getBrandMatches(source.brandRecommendation);
    const candidates = hasDecisions
      ? decisions
          .filter((d) => d.candidateId.startsWith("logo:"))
          .map((d) => ({
            ...common,
            logoName: "",
            logoTypeId: null,
            logoTypeName: "",
            ...old.find((m) => `logo:${m.assetLogoId}` === d.candidateId),
            assetLogoId: d.candidateId.slice(5),
            confidence: d.confidence,
          }))
      : old;
    const matches = candidates.filter((m) =>
      meetsFeatureConfidenceThreshold("brand", m.confidence, thresholds.brand),
    );
    output.brandRecommendation = {
      ...source.brandRecommendation,
      confidenceThreshold: thresholds.brand,
      ...(hasDecisions || Array.isArray(source.brandRecommendation.matches) ? { matches } : {}),
      bestMatch: matches[0] ?? null,
      noConfidentMatch: !matches.length,
      recommendedTags: matches.flatMap((m) => m.recommendedTags),
    };
  }
  if (source.ipRecommendation) {
    const old = getIpMatches(source.ipRecommendation);
    const candidates = hasDecisions
      ? decisions
          .filter((d) => d.candidateId.startsWith("ip:"))
          .map((d) => ({
            ...common,
            ipName: "",
            ipTypeId: null,
            ipTypeName: "",
            ...old.find((m) => `ip:${m.assetIpId}` === d.candidateId),
            assetIpId: d.candidateId.slice(3),
            confidence: d.confidence,
          }))
      : old;
    const matches = candidates.filter((m) =>
      meetsFeatureConfidenceThreshold("ip", m.confidence, thresholds.ip),
    );
    output.ipRecommendation = {
      ...source.ipRecommendation,
      confidenceThreshold: thresholds.ip,
      ...(hasDecisions || Array.isArray(source.ipRecommendation.matches) ? { matches } : {}),
      bestMatch: matches[0] ?? null,
      noConfidentMatch: !matches.length,
      recommendedTags: matches.flatMap((m) => m.recommendedTags),
    };
  }
  if (source.productRecommendation) {
    const old = getProductMatches(source.productRecommendation);
    const candidates = hasDecisions
      ? decisions
          .filter((d) => d.candidateId.startsWith("product:"))
          .map((d) => ({
            ...common,
            productName: "",
            productTypeId: null,
            productTypeName: "",
            generalCategory: "",
            ...source.productRecommendation!.detections?.flatMap(region => region.topMatches)
              .find(m => `product:${m.assetProductId}` === d.candidateId),
            ...old.find((m) => `product:${m.assetProductId}` === d.candidateId),
            assetProductId: d.candidateId.slice(8),
            confidence: d.confidence,
          }))
      : old;
    const winners = selectProductRegionWinners(candidates, source.productRecommendation.detections ?? []);
    const matches = winners.filter((m) =>
      meetsFeatureConfidenceThreshold("product", m.confidence, thresholds.product),
    );
    output.productRecommendation = {
      ...source.productRecommendation,
      decisionSource: hasDecisions ? "llm" : source.productRecommendation.decisionSource,
      confidenceThreshold: thresholds.product,
      ...(hasDecisions || Array.isArray(source.productRecommendation.matches) ? { matches } : {}),
      bestMatch: matches[0] ?? null,
      noConfidentMatch: !matches.length,
      recommendedTags: matches.flatMap((m) => m.recommendedTags),
      detections: source.productRecommendation.detections?.map(region => {
        const bestMatch = matches.find(match => match.detectionIndices.includes(region.detectionIndex)) ?? null;
        return { ...region, bestMatch, topMatches: bestMatch ? [bestMatch] : [], noConfidentMatch: !bestMatch };
      }),
    };
    if (diagnostics?.decision.result) {
      const kept = new Set(winners.map(match => `product:${match.assetProductId}`));
      output.featureDecision = { ...diagnostics, decision: { ...diagnostics.decision,
        result: { ...diagnostics.decision.result, matches: diagnostics.decision.result.matches.filter(match =>
          !match.candidateId.startsWith("product:") || kept.has(match.candidateId)) },
      } };
    }
  }
  if (source.personRecommendation) {
    const faces = source.personRecommendation.faces.map((face) => ({
      ...face,
      bestMatch:
        face.bestMatch &&
        isReviewablePersonFace(face) &&
        meetsFeatureConfidenceThreshold("person", face.bestMatch.confidence, thresholds.person)
          ? face.bestMatch
          : null,
    }));
    output.personRecommendation = {
      ...source.personRecommendation,
      confidenceThreshold: thresholds.person,
      faces,
      noConfidentMatch: !faces.some((f) => f.bestMatch),
      recommendedTags: faces.flatMap((f) => f.bestMatch?.recommendedTags ?? []),
    };
  }
  return output;
}
