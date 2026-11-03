import {
  FEATURE_REVIEW_CHANGED,
  featureKey,
  getFeatureReviewVersion,
  getFeatureReviewVersions,
  getReviewFeatures,
  hydrateReviewFeatures,
  selectReviewFeatures,
  type ReviewFeature,
} from "@/app/(tagging)/tagging/review/feature-review";
import type { TaggingQueueItemResult } from "@/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    team: { findUniqueOrThrow: vi.fn() },
    assetLogo: { findMany: vi.fn() },
    assetIp: { findMany: vi.fn() },
    assetProduct: { findMany: vi.fn() },
    assetPerson: { findMany: vi.fn() },
    assetLogoImage: { findMany: vi.fn() },
    assetIpImage: { findMany: vi.fn() },
    assetProductImage: { findMany: vi.fn() },
    assetPersonImage: { findMany: vi.fn() },
    assetTag: { findMany: vi.fn() },
    assetObject: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    taggingAuditItem: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    taggingQueueItem: { update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  syncAsset: vi.fn(),
  bind: vi.fn(),
  setTags: vi.fn(),
  request: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (args: { team: { id: number; slug: string } }) => unknown) =>
    fn({ team: { id: 7, slug: "t/7" } }),
}));
vi.mock("@/lib/feature-library-server", () => ({
  getServerFeatureLibraryFeatures: async () => ({
    featureLibrary: true,
    featureBrand: true,
    featureIp: true,
    featureProduct: true,
    featurePerson: true,
  }),
}));
vi.mock("@/musedam/assets", () => ({
  bindFeatureMaterialToMuseDAM: mocks.bind,
  setAssetTagsToMuseDAM: mocks.setTags,
  syncSingleAssetFromMuseDAM: mocks.syncAsset,
  batchSyncAssetThumbnails: async () => undefined,
  getFeatureByAssetFromMuseDAM: async () => [],
}));
vi.mock("@/musedam/apiKey", () => ({ retrieveTeamCredentials: async () => ({ apiKey: "test" }) }));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/app/(tagging)/evidence-policy-server", () => ({
  recordContentOnlyRejectionFeedbackBatch: vi.fn(),
}));
vi.mock("@/app/(tagging)/keyword-feedback", () => ({
  recordKeywordRejectionFeedbackBatch: vi.fn(),
}));

import {
  approveAuditItemsAction,
  batchApproveAuditItemsAction,
  fetchAssetsWithAuditItems,
  rejectAuditItemsAction,
} from "@/app/(tagging)/tagging/review/actions";

const ids = {
  brand: "11111111-1111-4111-8111-111111111111",
  ip: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  person: "44444444-4444-4444-8444-444444444444",
};
const oldTags = [{ assetTagId: 10, tagPath: ["Old tag"] }];
const newTags = [{ assetTagId: 20, tagPath: ["New tag"] }];
const evidence = { similarity: 0.9, confidence: 95, detectionIndex: 0 };
const secondProductId = "55555555-5555-4555-8555-555555555555";
function result(): TaggingQueueItemResult {
  const person = {
    ...evidence,
    rawSimilarity: 0.9,
    supportingReferenceCount: 1,
    assetPersonId: ids.person,
    personName: "Old person",
    personTypeId: null,
    personTypeName: "Old type",
    recommendedTags: oldTags.map((tag) => ({
      ...tag,
      assetPersonId: ids.person,
      personName: "Old person",
      detectionIndex: 0,
      confidence: 95,
    })),
  };
  return {
    brandRecommendation: {
      noConfidentMatch: false,
      recommendedTags: oldTags,
      bestMatch: {
        ...evidence,
        assetLogoId: ids.brand,
        logoName: "Old brand",
        logoTypeId: null,
        logoTypeName: "Old type",
        recommendedTags: oldTags,
      },
    },
    ipRecommendation: {
      noConfidentMatch: false,
      recommendedTags: oldTags,
      bestMatch: {
        ...evidence,
        assetIpId: ids.ip,
        ipName: "Old IP",
        ipTypeId: null,
        ipTypeName: "Old type",
        description: "old",
        imageSimilarity: 0.9,
        descriptionSimilarity: 0.9,
        recommendedTags: oldTags,
      },
    },
    productRecommendation: {
      noConfidentMatch: false,
      recommendedTags: oldTags,
      bestMatch: {
        ...evidence,
        assetProductId: ids.product,
        productName: "Old product",
        productTypeId: null,
        productTypeName: "Old type",
        description: "old",
        generalCategory: "old",
        imageSimilarity: 0.9,
        descriptionSimilarity: 0.9,
        recommendedTags: oldTags,
      },
    },
    personRecommendation: {
      noConfidentMatch: false,
      faceCount: 1,
      recommendedTags: person.recommendedTags,
      faces: [
        {
          detectionIndex: 0,
          noConfidentMatch: false,
          box: { xMin: 0, yMin: 0, xMax: 1, yMax: 1, score: 1, label: "face" },
          bestMatch: person,
          topMatches: [person],
        },
      ],
    },
  };
}
function currentFeatures(tags = newTags) {
  return new Map(
    Object.entries(ids).map(([type, id]) => [
      featureKey(type as ReviewFeature["featureType"], id),
      {
        featureType: type as ReviewFeature["featureType"],
        id,
        name: `New ${type}`,
        typeId: null,
        typeName: "New type",
        tags,
        ...(["ip", "product"].includes(type) ? { description: "new" } : {}),
        ...(type === "product" ? { generalCategory: "new" } : {}),
      },
    ]),
  );
}
function multipleProductResult(): TaggingQueueItemResult {
  const recommendation = result().productRecommendation!;
  const first = recommendation.bestMatch!;
  const second = {
    ...first,
    assetProductId: secondProductId,
    productName: "Other old product",
    confidence: 88,
    detectionIndex: 1,
    detectionIndices: [1, 2],
  };
  return {
    productRecommendation: {
      ...recommendation,
      matches: [first, second],
      detections: [first, second].map((match) => ({
        detectionIndex: match.detectionIndex,
        box: { xMin: 0, yMin: 0, xMax: 1, yMax: 1, score: 1, label: "product" },
        bestMatch: match,
        topMatches: [match],
        noConfidentMatch: false,
      })),
    },
  };
}
function currentProductFeatures(): ReviewFeature[] {
  return [
    {
      ...currentFeatures().get(featureKey("product", ids.product))!,
      tags: [...newTags, { assetTagId: 30, tagPath: ["First product only"] }],
    },
    {
      featureType: "product",
      id: secondProductId,
      name: "New second product",
      typeId: null,
      typeName: "New second type",
      description: "New second description",
      generalCategory: "New second category",
      tags: [...newTags, { assetTagId: 40, tagPath: ["Second product only"] }],
    },
  ];
}
function configureProductLibrary(features = currentProductFeatures()) {
  mocks.prisma.assetProduct.findMany.mockResolvedValue(
    features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      productTypeId: feature.typeId,
      productTypeName: feature.typeName,
      productType: null,
      description: feature.description,
      generalCategory: feature.generalCategory,
      tags: feature.tags.map((tag) => ({
        assetTagId: tag.assetTagId,
        assetTag: { name: tag.tagPath[0], parent: null },
      })),
    })),
  );
}
function multipleProductVersions() {
  return {
    1: getFeatureReviewVersion(
      hydrateReviewFeatures(
        queue.result,
        new Map(
          currentProductFeatures().map((feature) => [featureKey("product", feature.id), feature]),
        ),
      ),
    ),
  };
}
let assetExtra: Record<string, unknown>;
let queue: {
  id: number;
  result: TaggingQueueItemResult;
  extra: object;
  taskType: string;
  createdAt: Date;
};
let audits: {
  id: number;
  teamId: number;
  assetObjectId: number;
  status: string;
  score: number;
  leafTagId: number | null;
  tagPath: string[];
  queueItem: typeof queue;
  assetObject: { id: number; slug: string };
}[];
function configureLibrary(
  tags: ((typeof newTags)[number] & { slug?: string | null; teamId?: number })[] = newTags,
) {
  for (const [type, id] of Object.entries(ids)) {
    const delegate =
      mocks.prisma[
        (
          {
            brand: "assetLogo",
            ip: "assetIp",
            product: "assetProduct",
            person: "assetPerson",
          } as const
        )[type as keyof typeof ids]
      ];
    const prefix = type === "brand" ? "logo" : type;
    delegate.findMany.mockImplementation(async ({ select }) => [
      {
        id,
        name: `New ${type}`,
        [`${prefix}TypeId`]: null,
        [`${prefix}TypeName`]: "New type",
        [`${prefix}Type`]: null,
        description: "new",
        generalCategory: "new",
        tags: tags
          .filter(
            (tag) =>
              (tag.teamId ?? 7) === select.tags.where.assetTag.teamId &&
              (select.tags.where.assetTag.slug?.not !== null || tag.slug !== null),
          )
          .map((tag) => ({
            assetTagId: tag.assetTagId,
            assetTag: { name: tag.tagPath[0], parent: null },
          })),
      },
    ]);
  }
}
function input() {
  return {
    assetSlug: "a/42",
    auditItems: audits.map(({ id, leafTagId }) => ({ id, leafTagId, status: "approved" as const })),
    featureReviewVersions: {
      1: getFeatureReviewVersion(hydrateReviewFeatures(queue.result, currentFeatures())),
    },
    rejectedFeatureKeys: [] as string[],
  };
}
function batchInput(versions = input().featureReviewVersions, rejectedFeatureKeys: string[] = []) {
  return {
    assetObjects: [{ id: 42, slug: "a/42", featureReviewVersions: versions, rejectedFeatureKeys }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  assetExtra = { extension: "psd", thumbnailAccessUrl: "test-thumbnail" };
  queue = { id: 1, result: result(), extra: {}, taskType: "default", createdAt: new Date() };
  audits = [
    {
      id: 1,
      teamId: 7,
      assetObjectId: 42,
      status: "pending",
      score: 95,
      leafTagId: null,
      tagPath: [],
      queueItem: queue,
      assetObject: { id: 42, slug: "a/42" },
    },
  ];
  configureLibrary();
  for (const images of [
    mocks.prisma.assetLogoImage,
    mocks.prisma.assetIpImage,
    mocks.prisma.assetProductImage,
    mocks.prisma.assetPersonImage,
  ]) {
    images.findMany.mockResolvedValue([]);
  }
  mocks.prisma.$queryRaw.mockImplementation(async (query) =>
    query.sql.includes("COUNT(DISTINCT") ? [{ count: BigInt(1) }] : [{ assetObjectId: 42 }],
  );
  mocks.prisma.team.findUniqueOrThrow.mockResolvedValue({ id: 7, slug: "t/7" });
  mocks.prisma.taggingAuditItem.findMany.mockImplementation(async (args) =>
    args.distinct ? [{ assetObjectId: 42 }] : audits,
  );
  mocks.prisma.assetObject.findUniqueOrThrow.mockImplementation(async () => ({
    id: 42,
    extra: assetExtra,
  }));
  mocks.prisma.assetObject.findMany.mockImplementation(async () => [
    { id: 42, slug: "a/42", extra: assetExtra, taggingAuditItems: audits },
  ]);
  mocks.prisma.assetTag.findMany.mockImplementation(async (args) =>
    (args.where.id?.in ?? []).map((id: number) => ({
      id,
      slug: `g/${id}`,
      name: `Tag ${id}`,
      parent: null,
    })),
  );
  mocks.prisma.$transaction.mockImplementation(async (fn) => fn(mocks.prisma));
  mocks.request.mockResolvedValue([{ id: 42, tags: [] }]);
  mocks.bind.mockResolvedValue(true);
});

describe("review feature synchronization", () => {
  it("refreshes every accepted product and keeps each detection's evidence", async () => {
    queue.result = multipleProductResult();
    configureProductLibrary();

    const response = await fetchAssetsWithAuditItems();
    if (!response.success) throw new Error(response.message);
    const displayed = response.data.assets[0].batch[0].queueItem.result as TaggingQueueItemResult;
    expect(getReviewFeatures(displayed)).toEqual(currentProductFeatures());
    expect(displayed.productRecommendation?.matches?.map((match) => match.confidence)).toEqual([
      95, 88,
    ]);
    expect(displayed.productRecommendation?.matches?.[1].detectionIndices).toEqual([1, 2]);
    expect(displayed.productRecommendation?.recommendedTags.map((tag) => tag.assetTagId)).toEqual([
      20, 30, 40,
    ]);
    expect(mocks.prisma.assetProduct.findMany.mock.calls[0][0].where).toEqual({
      teamId: 7,
      enabled: true,
      id: { in: [ids.product, secondProductId] },
    });
    expect(response.data.assets[0].availableFeatureIds.product).toEqual([
      ids.product,
      secondProductId,
    ]);
  });

  it.each(["single", "batch"])("%s Add binds every accepted product", async (mode) => {
    queue.result = multipleProductResult();
    configureProductLibrary();
    const versions = multipleProductVersions();
    const response =
      mode === "single"
        ? await approveAuditItemsAction({ ...input(), featureReviewVersions: versions })
        : await batchApproveAuditItemsAction(batchInput(versions));

    expect(response.success).toBe(true);
    expect(mocks.bind.mock.calls.map(([args]) => args.identifierId)).toEqual([
      ids.product,
      secondProductId,
    ]);
    expect(mocks.setTags.mock.calls[0][0].musedamTagIds.map(String)).toEqual(["20", "30", "40"]);
  });

  it.each(["single", "batch"])(
    "%s Add rejects a product independently while preserving another product's shared tag",
    async (mode) => {
      queue.result = multipleProductResult();
      configureProductLibrary();
      const versions = multipleProductVersions();
      const rejected = [featureKey("product", ids.product)];
      const response =
        mode === "single"
          ? await approveAuditItemsAction({
              ...input(),
              featureReviewVersions: versions,
              rejectedFeatureKeys: rejected,
            })
          : await batchApproveAuditItemsAction(batchInput(versions, rejected));

      expect(response.success).toBe(true);
      expect(mocks.bind.mock.calls.map(([args]) => args.identifierId)).toEqual([secondProductId]);
      expect(mocks.setTags.mock.calls[0][0].musedamTagIds.map(String)).toEqual(["20", "40"]);
      const snapshot = mocks.prisma.taggingQueueItem.update.mock.calls[0][0].data.extra
        .featureReview.result as TaggingQueueItemResult;
      expect(snapshot.productRecommendation?.matches?.map((match) => match.assetProductId)).toEqual(
        [secondProductId],
      );
      expect(snapshot.productRecommendation?.bestMatch?.assetProductId).toBe(secondProductId);
      expect(snapshot.productRecommendation?.detections?.[0]).toMatchObject({
        bestMatch: null,
        topMatches: [],
        noConfidentMatch: true,
      });
      expect(getReviewFeatures(snapshot).map((feature) => feature.id)).toEqual([secondProductId]);
    },
  );

  it("removes only an unavailable product and can approve the remaining product", async () => {
    queue.result = multipleProductResult();
    configureProductLibrary(currentProductFeatures().slice(1));
    const response = await fetchAssetsWithAuditItems();
    if (!response.success) throw new Error(response.message);
    const displayed = response.data.assets[0].batch[0].queueItem.result as TaggingQueueItemResult;
    expect(displayed.productRecommendation?.matches?.map((match) => match.assetProductId)).toEqual([
      secondProductId,
    ]);
    expect(displayed.productRecommendation?.bestMatch?.assetProductId).toBe(secondProductId);

    const approval = await approveAuditItemsAction({
      ...input(),
      featureReviewVersions: { 1: getFeatureReviewVersion(displayed) },
    });
    expect(approval.success).toBe(true);
    expect(mocks.bind.mock.calls.map(([args]) => args.identifierId)).toEqual([secondProductId]);
  });

  it.each(["single", "batch"])(
    "%s Add detects association changes on the second product",
    async (mode) => {
      queue.result = multipleProductResult();
      const versions = multipleProductVersions();
      const features = currentProductFeatures();
      features[1].tags = [{ assetTagId: 50, tagPath: ["Changed second product tag"] }];
      configureProductLibrary(features);
      const response =
        mode === "single"
          ? await approveAuditItemsAction({ ...input(), featureReviewVersions: versions })
          : await batchApproveAuditItemsAction(batchInput(versions));

      expect(response).toMatchObject(
        mode === "single"
          ? { success: false, message: FEATURE_REVIEW_CHANGED }
          : { success: true, data: { changedCount: 1, failedCount: 0 } },
      );
      expect(mocks.bind).not.toHaveBeenCalled();
      expect(mocks.setTags).not.toHaveBeenCalled();
    },
  );

  it("applies the confidence threshold to each product and respects an explicit empty match list", () => {
    const source = multipleProductResult();
    source.productRecommendation!.matches![1].confidence = 79;
    expect(getReviewFeatures(source).map((feature) => feature.id)).toEqual([ids.product]);
    source.productRecommendation!.matches = [];
    expect(getReviewFeatures(source)).toEqual([]);
    const refreshed = hydrateReviewFeatures(source, currentFeatures());
    expect(refreshed.productRecommendation).toMatchObject({
      matches: [],
      bestMatch: null,
      recommendedTags: [],
    });
    expect(getReviewFeatures(refreshed)).toEqual([]);
  });

  it("loads current names, types and tags for all four features without rewriting recognition evidence", async () => {
    const response = await fetchAssetsWithAuditItems();
    expect(response.success).toBe(true);
    if (!response.success) return;
    const displayed = response.data.assets[0].batch[0].queueItem.result as TaggingQueueItemResult;
    expect(getReviewFeatures(displayed)).toEqual([...currentFeatures().values()]);
    expect(displayed.brandRecommendation?.bestMatch?.confidence).toBe(95);
    expect(displayed.personRecommendation?.faces[0].topMatches).toEqual(
      queue.result.personRecommendation?.faces[0].topMatches,
    );
    expect(queue.result.brandRecommendation?.recommendedTags).toEqual(oldTags);
    expect(mocks.prisma.assetLogo.findMany.mock.calls[0][0].where).toMatchObject({
      teamId: 7,
      enabled: true,
    });
  });

  it("shows current tags without MuseDAM IDs for all four features, excluding other teams' tags", async () => {
    const currentTags = [...newTags, { assetTagId: 21, tagPath: ["Synced tag"] }];
    configureLibrary([
      { ...currentTags[0], slug: null },
      { ...currentTags[1], slug: "g/21" },
      { assetTagId: 22, tagPath: ["Other team's tag"], slug: null, teamId: 8 },
    ]);

    const response = await fetchAssetsWithAuditItems();
    if (!response.success) throw new Error(response.message);
    const displayed = response.data.assets[0].batch[0].queueItem.result;
    expect(getReviewFeatures(displayed)).toEqual([...currentFeatures(currentTags).values()]);
  });

  it.each(["single", "batch"])(
    "%s Add binds features whose current tags do not have MuseDAM IDs",
    async (mode) => {
      configureLibrary(newTags.map((tag) => ({ ...tag, slug: null })));
      mocks.prisma.assetTag.findMany.mockImplementation(async ({ where }) =>
        where.slug?.not === null ? [] : [{ id: 20, slug: null }],
      );

      const response =
        mode === "single"
          ? await approveAuditItemsAction(input())
          : await batchApproveAuditItemsAction(batchInput());
      expect(response.success).toBe(true);
      expect(mocks.setTags).not.toHaveBeenCalled();
      expect(mocks.bind.mock.calls.map(([args]) => args.identifierId).sort()).toEqual(
        Object.values(ids).sort(),
      );
    },
  );

  it.each(["single", "batch"])(
    "%s Add sends current tags and selected identifiers to MuseDAM",
    async (mode) => {
      const response =
        mode === "single"
          ? await approveAuditItemsAction(input())
          : await batchApproveAuditItemsAction(batchInput());
      expect(response.success).toBe(true);
      expect(mocks.setTags).toHaveBeenCalledTimes(1);
      expect(mocks.setTags.mock.calls[0][0].musedamTagIds.map(String)).toEqual(["20"]);
      expect(mocks.bind.mock.calls.map(([args]) => args.identifierId).sort()).toEqual(
        Object.values(ids).sort(),
      );
      expect(
        mocks.prisma.taggingQueueItem.update.mock.calls[0][0].data.extra.featureReview.result
          .brandRecommendation.recommendedTags,
      ).toEqual(newTags);
    },
  );

  it.each(["single", "batch"])(
    "%s Add stops before writes if the associations changed after rendering",
    async (mode) => {
      const stale = { 1: getFeatureReviewVersion(queue.result) };
      const response =
        mode === "single"
          ? await approveAuditItemsAction({ ...input(), featureReviewVersions: stale })
          : await batchApproveAuditItemsAction(batchInput(stale));
      expect(response).toMatchObject(
        mode === "single"
          ? { success: false, message: FEATURE_REVIEW_CHANGED }
          : { success: true, data: { changedCount: 1, failedCount: 0 } },
      );
      expect(mocks.setTags).not.toHaveBeenCalled();
      expect(mocks.bind).not.toHaveBeenCalled();
      expect(mocks.prisma.taggingAuditItem.updateMany).not.toHaveBeenCalled();
    },
  );

  it.each(["single", "batch"])(
    "%s Add supports features with no tags and honors removal independently",
    async (mode) => {
      configureLibrary([]);
      const versions = {
        1: getFeatureReviewVersion(hydrateReviewFeatures(queue.result, currentFeatures([]))),
      };
      const rejected = [featureKey("brand", ids.brand), featureKey("person", ids.person)];
      const response =
        mode === "single"
          ? await approveAuditItemsAction({
              ...input(),
              featureReviewVersions: versions,
              rejectedFeatureKeys: rejected,
            })
          : await batchApproveAuditItemsAction(batchInput(versions, rejected));
      expect(response.success).toBe(true);
      expect(mocks.setTags).not.toHaveBeenCalled();
      expect(mocks.bind.mock.calls.map(([args]) => args.identifierId).sort()).toEqual(
        [ids.ip, ids.product].sort(),
      );
    },
  );

  it("does not reintroduce removed features through shared tag IDs", async () => {
    await batchApproveAuditItemsAction(batchInput(undefined, [featureKey("brand", ids.brand)]));
    expect(mocks.setTags.mock.calls[0][0].musedamTagIds.map(String)).toEqual(["20"]);
    expect(mocks.bind.mock.calls.map(([args]) => args.identifierId)).not.toContain(ids.brand);
  });

  it("removes deleted features when refreshed, then binds only the remaining features", async () => {
    mocks.prisma.assetLogo.findMany.mockResolvedValue([]);
    const response = await fetchAssetsWithAuditItems();
    if (!response.success) throw new Error(response.message);
    const displayed = response.data.assets[0].batch[0].queueItem.result;
    expect((displayed as TaggingQueueItemResult).brandRecommendation).toBeNull();
    await approveAuditItemsAction({
      ...input(),
      featureReviewVersions: { 1: getFeatureReviewVersion(displayed) },
    });
    expect(mocks.bind.mock.calls.map(([args]) => args.identifierId)).not.toContain(ids.brand);
  });

  it("preserves person confidence thresholds after refreshing metadata", () => {
    const source = result();
    source.personRecommendation!.faces[0].topMatches[0].rawSimilarity = 0.2;
    const updated = hydrateReviewFeatures(source, currentFeatures());
    expect(selectReviewFeatures([updated]).map((feature) => feature.featureType)).not.toContain(
      "person",
    );
  });

  it("preserves the approved feature details when the library changes again", async () => {
    await approveAuditItemsAction(input());
    queue.extra = mocks.prisma.taggingQueueItem.update.mock.calls[0][0].data.extra;
    audits[0].status = "approved";
    configureLibrary([{ assetTagId: 30, tagPath: ["Changed again"] }]);
    const response = await fetchAssetsWithAuditItems();
    if (!response.success) throw new Error(response.message);
    expect(getReviewFeatures(response.data.assets[0].batch[0].queueItem.result)[0].tags).toEqual(
      newTags,
    );
  });

  it("does not mark review complete when MuseDAM rejects a feature binding", async () => {
    mocks.bind.mockResolvedValue(false);
    const response = await approveAuditItemsAction(input());
    expect(response).toMatchObject({
      success: false,
      message: expect.stringContaining("添加失败"),
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.taggingQueueItem.update).not.toHaveBeenCalled();
  });

  it("returns a missing-asset result and logs its identity without applying or approving anything", async () => {
    mocks.syncAsset.mockRejectedValueOnce(new Error("Asset not found"));
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(approveAuditItemsAction(input())).resolves.toEqual({
        success: false,
        code: "not_found",
        message: "Asset not found",
      });
      expect(log).toHaveBeenCalledWith("审核添加时未查询到 MuseDAM 素材:", {
        teamId: 7,
        assetSlug: "a/42",
        musedamAssetId: "42",
        stage: "sync-asset",
      });
      expect(mocks.setTags).not.toHaveBeenCalled();
      expect(mocks.bind).not.toHaveBeenCalled();
      expect(mocks.prisma.assetObject.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { slug: "a/42", teamId: 7 },
        select: { id: true, extra: true },
      });
      expect(mocks.prisma.assetObject.update).toHaveBeenCalledWith({
        where: { id: 42, teamId: 7 },
        data: { extra: { ...assetExtra, reviewAssetDeleted: true } },
      });
      expect(mocks.prisma.taggingAuditItem.updateMany).toHaveBeenCalledWith({
        where: { teamId: 7, assetObjectId: 42 },
        data: { status: "rejected" },
      });
    } finally {
      log.mockRestore();
    }
  });

  it("marks a missing asset as deleted during batch approval too", async () => {
    mocks.request.mockResolvedValueOnce([]);
    const response = await batchApproveAuditItemsAction(batchInput());
    expect(response).toMatchObject({ success: true, data: { deletedCount: 1, failedCount: 0 } });
    expect(mocks.prisma.assetObject.update).toHaveBeenCalledWith({
      where: { id: 42, teamId: 7 },
      data: { extra: { ...assetExtra, reviewAssetDeleted: true } },
    });
    expect(mocks.prisma.taggingAuditItem.updateMany).toHaveBeenCalledWith({
      where: { teamId: 7, assetObjectId: 42 },
      data: { status: "rejected" },
    });
    expect(mocks.setTags).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it.each([undefined, "rejected"] as const)(
    "keeps deleted asset records visible with the deletion marker under filter %s",
    async (status) => {
      assetExtra.reviewAssetDeleted = true;
      audits[0].status = "rejected";
      const response = await fetchAssetsWithAuditItems(1, 10, status);
      if (!response.success) throw new Error(response.message);
      expect(response.data.total).toBe(1);
      expect(response.data.assets).toHaveLength(1);
      expect(response.data.assets[0].assetObject.extra).toMatchObject({ reviewAssetDeleted: true });
      expect(response.data.assets[0].batch[0].taggingAuditItems[0].status).toBe("rejected");
    },
  );

  it("retains ordinary rejected records under the rejected filter without a deleted marker", async () => {
    audits[0].status = "rejected";
    const response = await fetchAssetsWithAuditItems(1, 10, "rejected");
    if (!response.success) throw new Error(response.message);
    expect(response.data.assets).toHaveLength(1);
    expect(response.data.assets[0].assetObject.extra).not.toHaveProperty("reviewAssetDeleted");
    expect(response.data.assets[0].batch[0].taggingAuditItems[0].status).toBe("rejected");
  });

  it("does not label a reviewer's ordinary rejection as a deleted asset", async () => {
    const response = await rejectAuditItemsAction({ assetSlug: "a/42" });
    expect(response.success).toBe(true);
    expect(mocks.prisma.taggingAuditItem.updateMany).toHaveBeenCalled();
    expect(mocks.prisma.assetObject.update).not.toHaveBeenCalled();
  });

  it.each(["prepare", "sync-asset", "set-tags", "refresh-tags", "save-review"])(
    "returns a safe failure and logs context when %s fails",
    async (stage) => {
      const error = new Error("Internal customer API or database details");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        if (stage === "prepare") mocks.prisma.team.findUniqueOrThrow.mockRejectedValueOnce(error);
        if (stage === "sync-asset") mocks.syncAsset.mockRejectedValueOnce(error);
        if (stage === "set-tags") mocks.setTags.mockRejectedValueOnce(error);
        if (stage === "refresh-tags") mocks.request.mockRejectedValueOnce(error);
        if (stage === "save-review") mocks.prisma.$transaction.mockRejectedValueOnce(error);
        const response = await approveAuditItemsAction(input());
        expect(response).toEqual({
          success: false,
          message: "添加失败，请稍后重试；若持续失败请联系管理员",
        });
        expect(log).toHaveBeenCalledWith(
          "添加 AI 打标审核结果失败:",
          { teamId: 7, assetSlug: "a/42", stage },
          error,
        );
        expect(mocks.prisma.taggingAuditItem.update).not.toHaveBeenCalled();
        expect(mocks.prisma.taggingQueueItem.update).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );

  it("excludes completed history and old default batches from approval versions", () => {
    const batch = [
      { queueItem: queue, taggingAuditItems: [{ status: "pending" }] },
      { queueItem: { ...queue, id: 2 }, taggingAuditItems: [{ status: "pending" }] },
      {
        queueItem: { ...queue, id: 3, taskType: "manual" },
        taggingAuditItems: [{ status: "approved" }],
      },
    ];
    expect(Object.keys(getFeatureReviewVersions(batch))).toEqual(["1"]);
  });
});
