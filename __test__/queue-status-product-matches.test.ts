// @vitest-environment node

import type { TaggingProductBestMatch } from "@/prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findQueueItem: vi.fn(),
  findProductTags: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (args: { team: { id: number } }) => unknown) => fn({ team: { id: 7 } }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    taggingQueueItem: { findFirst: mocks.findQueueItem },
    assetProductTag: { findMany: mocks.findProductTags },
  },
}));
vi.mock("@/app/(tagging)/queue-estimate", () => ({ getQueueWaitEstimate: vi.fn() }));
vi.mock("@/lib/feature-library-server", () => ({
  getFeatureLibraryFeaturesFromRequest: () => ({
    featureLibrary: true,
    featureBrand: false,
    featureIp: false,
    featureProduct: true,
    featurePerson: false,
  }),
}));

import { GET } from "@/app/(tagging)/api/tagging/queue-status/[queueItemId]/route";

function product(assetProductId: string, confidence: number): TaggingProductBestMatch {
  return {
    assetProductId,
    productName: assetProductId,
    productTypeId: null,
    productTypeName: "Product",
    description: "",
    generalCategory: "",
    similarity: confidence / 100,
    confidence,
    detectionIndex: 0,
    imageSimilarity: confidence / 100,
    descriptionSimilarity: 0,
    recommendedTags: [],
  };
}

async function responseData(matches: TaggingProductBestMatch[]) {
  mocks.findQueueItem.mockResolvedValue({
    id: 42,
    teamId: 7,
    status: "completed",
    result: {
      productRecommendation: {
        bestMatch: product("legacy-alias", 99),
        matches,
        noConfidentMatch: matches.length === 0,
        recommendedTags: [],
      },
    },
  });
  const response = await GET(new NextRequest("http://localhost/api/tagging/queue-status/42"), {
    params: Promise.resolve({ queueItemId: "42" }),
  });
  return response.json();
}

describe("queue status product tag associations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads tags for every accepted product and keeps their product associations in the response", async () => {
    mocks.findProductTags.mockResolvedValue([
      { assetProductId: "phone", assetTagId: 10, tagPath: ["Shared"] },
      { assetProductId: "headphones", assetTagId: 10, tagPath: ["Shared"] },
      { assetProductId: "headphones", assetTagId: 20, tagPath: ["Headphones"] },
    ]);
    const result = await responseData([
      product("phone", 92),
      product("headphones", 80),
      product("weak", 79),
    ]);

    expect(result.success).toBe(true);
    expect(mocks.findProductTags).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetProductId: { in: ["phone", "headphones"] }, assetTagId: { not: null } },
      }),
    );
    expect(result.data.productLinkedTags).toEqual([
      { assetProductId: "phone", assetTagId: 10, tagPath: ["Shared"] },
      { assetProductId: "headphones", assetTagId: 10, tagPath: ["Shared"] },
      { assetProductId: "headphones", assetTagId: 20, tagPath: ["Headphones"] },
    ]);
  });

  it("does not query or show legacy product tags when the accepted list is explicitly empty", async () => {
    const result = await responseData([]);
    expect(mocks.findProductTags).not.toHaveBeenCalled();
    expect(result.data.productLinkedTags).toEqual([]);
  });
});
