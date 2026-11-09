import prisma from "@/prisma/prisma";
import "server-only";
import { matchProductsByAssetName } from "./product-name-match";

export async function findProductNameMatches(teamId: number, assetName?: string | null) {
  const namedProducts = assetName?.trim()
    ? matchProductsByAssetName(
        assetName,
        await prisma.assetProduct.findMany({
          where: { teamId, enabled: true, status: "completed" },
          select: {
            id: true,
            name: true,
            productTypeId: true,
            productTypeName: true,
            description: true,
            generalCategory: true,
            tags: {
              where: { assetTag: { teamId, deletedAt: null } },
              orderBy: [{ sort: "asc" }, { id: "asc" }],
              select: { id: true, assetTagId: true, tagPath: true },
            },
          },
        }),
      )
    : [];
  return namedProducts.map((product) => ({
    assetProductId: product.id,
    productName: product.name,
    productTypeId: product.productTypeId,
    productTypeName: product.productTypeName,
    description: product.description,
    generalCategory: product.generalCategory,
    confidence: 100,
    similarity: 1,
    // A literal filename match is not an observed image region.
    detectionIndex: -1,
    detectionIndices: [],
    imageSimilarity: 0,
    descriptionSimilarity: 0,
    matchingSource: "assetName" as const,
    recommendedTags: product.tags.map((tag) => ({
      ...tag,
      tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
    })),
  }));
}
