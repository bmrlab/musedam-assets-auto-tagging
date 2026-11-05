import "server-only";

import { normalizeRecommendedTags } from "@/lib/tagging/classification-image";
import type {
  TaggingBrandRecommendation,
  TaggingIpRecommendation,
  TaggingProductRecommendation,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import type { AssetFeatureClassification } from "./classify";

/** Only final accepted matches contribute linked tags. Retrieval candidates stay in diagnostics. */
export async function buildFeatureRecommendations(result: AssetFeatureClassification): Promise<{
  brandRecommendation: TaggingBrandRecommendation | null;
  ipRecommendation: TaggingIpRecommendation | null;
  productRecommendation: TaggingProductRecommendation | null;
}> {
  const brand = result.brand;
  const ip = result.ip;
  const product = result.product;
  const brandMatches =
    brand?.matches ?? (brand?.bestMatch && !brand.noConfidentMatch ? [brand.bestMatch] : []);
  const logoTags = brandMatches.length
    ? await prisma.assetLogoTag
        .findMany({
          where: {
            assetLogoId: { in: brandMatches.map((match) => match.assetLogoId) },
            assetTagId: { not: null },
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
          select: { assetLogoId: true, assetTagId: true, tagPath: true },
        })
        .catch((error) => {
          result.diagnostics.retrieval?.errors.push(
            `logo linked tags: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        })
    : [];
  const normalizedBrands = brandMatches.map((match) => ({
    ...match,
    recommendedTags: normalizeRecommendedTags(
      logoTags.filter((tag) => tag.assetLogoId === match.assetLogoId),
    ),
  }));
  const ipMatches = (
    ip?.matches ?? (ip?.bestMatch && !ip.noConfidentMatch ? [ip.bestMatch] : [])
  ).map((match) => ({
    ...match,
    recommendedTags: normalizeRecommendedTags(match.recommendedTags),
  }));
  const productMatches = (product?.matches ?? []).map((match) => ({
    ...match,
    recommendedTags: normalizeRecommendedTags(match.recommendedTags),
  }));
  const decisionSource =
    result.diagnostics.mode === "legacy" ? ("legacy" as const) : ("llm" as const);
  return {
    brandRecommendation: brand
      ? {
          decisionSource,
          noConfidentMatch: normalizedBrands.length === 0,
          matches: normalizedBrands,
          bestMatch: normalizedBrands[0] ?? null,
          recommendedTags: normalizeRecommendedTags(
            normalizedBrands.flatMap((match) => match.recommendedTags),
          ),
        }
      : null,
    ipRecommendation: ip
      ? {
          decisionSource,
          noConfidentMatch: ipMatches.length === 0,
          matches: ipMatches,
          bestMatch: ipMatches[0] ?? null,
          recommendedTags: normalizeRecommendedTags(
            ipMatches.flatMap((match) => match.recommendedTags),
          ),
        }
      : null,
    productRecommendation: product
      ? {
          decisionSource,
          noConfidentMatch: productMatches.length === 0,
          matches: productMatches,
          rawDetections: product.rawDetections,
          detections: product.detections.map((region) => ({
            ...region,
            topMatches: region.topMatches.map((match) => ({
              ...match,
              recommendedTags: normalizeRecommendedTags(match.recommendedTags),
            })),
            bestMatch: region.bestMatch
              ? {
                  ...region.bestMatch,
                  recommendedTags: normalizeRecommendedTags(region.bestMatch.recommendedTags),
                }
              : null,
          })),
          bestMatch: productMatches[0] ?? null,
          recommendedTags: normalizeRecommendedTags(
            productMatches.flatMap((match) => match.recommendedTags),
          ),
        }
      : null,
  };
}
