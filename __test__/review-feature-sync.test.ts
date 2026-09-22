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
    assetTag: { findMany: vi.fn() },
    assetObject: { findMany: vi.fn(), update: vi.fn() },
    taggingAuditItem: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    taggingQueueItem: { update: vi.fn() },
    $transaction: vi.fn(),
  },
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
  syncSingleAssetFromMuseDAM: vi.fn(),
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
  mocks.prisma.team.findUniqueOrThrow.mockResolvedValue({ id: 7, slug: "t/7" });
  mocks.prisma.taggingAuditItem.findMany.mockImplementation(async (args) =>
    args.distinct ? [{ assetObjectId: 42 }] : audits,
  );
  mocks.prisma.assetObject.findMany.mockImplementation(async () => [
    { id: 42, slug: "a/42", taggingAuditItems: audits },
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
    "%s Add binds features whose current tags do not have MuseDAM IDs", async (mode) => {
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
    await expect(approveAuditItemsAction(input())).rejects.toThrow("Failed to bind feature");
    expect(mocks.prisma.taggingQueueItem.update).not.toHaveBeenCalled();
  });

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
