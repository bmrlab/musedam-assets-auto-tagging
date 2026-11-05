// @vitest-environment node
import { processQueueItem } from "@/app/(tagging)/queue";
import { fetchAssetsWithAuditItems } from "@/app/(tagging)/tagging/review/actions";
import {
  fetchMetadataReviews,
  reviewMetadata,
} from "@/app/(tagging)/tagging/review/metadata-actions";
import { getTaggingSettings, saveTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { flushMetadataSettingAudits } from "@/musedam/metadata-settings-audit";
import { PrismaClient } from "@/prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const testUrl = process.env.METADATA_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.startsWith("/metadata_ai_test")
  )
    throw new Error("Use a disposable local metadata_ai_test database");
}
const state = vi.hoisted(() => ({
  team: { id: 0, slug: "" },
  apply: vi.fn(),
  context: vi.fn(),
  auditRequest: vi.fn(),
  predict: vi.fn(),
  client: undefined as PrismaClient | undefined,
}));
vi.mock("@/lib/metadata/predict", () => ({ predictMetadata: state.predict }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: async (fn: (args: unknown) => unknown) => fn({ team: state.team, user: { id: 1 } }),
}));
vi.mock("@/app/(auth)/lib", () => ({ checkUserPermission: async () => ({}) }));
vi.mock("@/prisma/prisma", async () => {
  const { PrismaClient } = await import("@/prisma/client");
  const url = process.env.METADATA_TEST_DATABASE_URL;
  state.client = url ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
  return { default: state.client ?? {} };
});
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: async () => ({ apiKey: "local-test-only" }),
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: state.auditRequest }));
vi.mock("@/musedam/metadata", () => ({
  applyMetadataPredictions: state.apply,
  fetchMetadataContext: state.context,
}));
vi.mock("@/lib/feature-library-server", () => ({
  getServerFeatureLibraryFeatures: async () => ({
    featureLibrary: false,
    featureBrand: false,
    featureProduct: false,
    featureIp: false,
    featurePerson: false,
  }),
}));
vi.mock("@/musedam/assets", () => ({
  batchSyncAssetThumbnails: async () => {},
  setAssetTagsToMuseDAM: vi.fn(),
  syncSingleAssetFromMuseDAM: vi.fn(),
  bindFeatureMaterialToMuseDAM: vi.fn(),
  getFeatureByAssetFromMuseDAM: async () => [],
}));
vi.mock("@/app/(tagging)/tagging/review/feature-review-server", () => ({
  loadReviewFeatureLibrary: async () => new Map(),
  loadFeatureThumbnails: async () => ({}),
  loadManualReviewFeatures: async () => [],
  searchReviewFeatureLibrary: async () => [],
}));
let teamIds: number[] = [];
let rowId = 0;
let secondRowId = 0;
const prediction = {
  fieldId: "f",
  expectedFieldVersion: 2,
  fieldName: "Channel",
  optionIds: ["a"],
  labels: ["Retail"],
  confidence: 0.9,
  score: 90,
  effective: true,
  sources: [{ source: "basicInfo", confidence: 0.9, evidence: "Retail" }],
};
describe.skipIf(!testUrl)("metadata reviews with real PostgreSQL", () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const team = await state.client!.team.create({ data: { slug: `t/${900001 + i}` } });
      teamIds.push(team.id);
      const asset = await state.client!.assetObject.create({
        data: {
          teamId: team.id,
          slug: `a/${900001 + i}`,
          name: "Retail",
          description: "",
          materializedPath: "folder",
        },
      });
      const queue = await state.client!.taggingQueueItem.create({
        data: { teamId: team.id, assetObjectId: asset.id, status: "completed" },
      });
      const row = await state.client!.metadataAuditItem.create({
        data: {
          teamId: team.id,
          assetObjectId: asset.id,
          queueItemId: queue.id,
          fieldId: "f",
          prediction,
        },
      });
      if (!i) {
        state.team = { id: team.id, slug: team.slug };
        rowId = row.id;
      } else secondRowId = row.id;
    }
  });
  beforeEach(async () => {
    state.predict.mockReset();
    state.predict.mockResolvedValue([]);
    state.apply.mockReset();
    state.context.mockReset();
    state.auditRequest.mockReset();
    state.auditRequest.mockResolvedValue(true);
    state.apply.mockResolvedValue({ applied: ["f"], skipped: [] });
    state.context.mockResolvedValue({ enabled: true, fields: [{ fieldId: "f", fieldVersion: 2 }] });
    await state.client!.metadataAuditItem.update({
      where: { id: rowId },
      data: { status: "pending" },
    });
    await saveTaggingSettings(state.team.id, {
      ...DEFAULT_TAGGING_SETTINGS,
      isMetadataEnabled: true,
    });
  });
  afterAll(async () => {
    if (state.client) {
      await state.client.metadataAuditItem.deleteMany({ where: { teamId: { in: teamIds } } });
      await state.client.taggingQueueItem.deleteMany({ where: { teamId: { in: teamIds } } });
      await state.client.assetObject.deleteMany({ where: { teamId: { in: teamIds } } });
      await state.client.teamConfig.deleteMany({ where: { teamId: { in: teamIds } } });
      await state.client.team.deleteMany({ where: { id: { in: teamIds } } });
      await state.client.$disconnect();
    }
  });
  it("migrates old settings with field filling disabled and preserves tag switch", async () => {
    await state.client!.teamConfig.deleteMany({
      where: { teamId: state.team.id, key: "isMetadataEnabled" },
    });
    await state.client!.teamConfig.update({
      where: { teamId_key: { teamId: state.team.id, key: "isTaggingEnabled" } },
      data: { value: true },
    });
    const settings = await getTaggingSettings(state.team.id);
    expect(settings.isMetadataEnabled).toBe(false);
    expect(settings.isTaggingEnabled).toBe(true);
  });
  it("lists only this team and blocks cross-team review", async () => {
    expect((await fetchMetadataReviews()).rows.map((r) => r.id)).toEqual([rowId]);
    await expect(reviewMetadata([secondRowId], "approve")).rejects.toThrow("Invalid review");
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("persists approval and does not reapply approved rows", async () => {
    expect(await reviewMetadata([rowId], "approve")).toEqual({ applied: 1, skipped: 0 });
    await reviewMetadata([rowId], "approve");
    expect(state.apply).toHaveBeenCalledTimes(1);
    expect(state.apply.mock.calls[0][3]).toBe(`metadata:review:${rowId}`);
    expect(
      (await state.client!.metadataAuditItem.findUniqueOrThrow({ where: { id: rowId } })).status,
    ).toBe("approved");
  });
  it("preserves human values reported at approval time", async () => {
    state.apply.mockResolvedValue({ applied: [], skipped: ["f"] });
    expect(await reviewMetadata([rowId], "approve")).toEqual({ applied: 0, skipped: 1 });
    expect(
      (await state.client!.metadataAuditItem.findUniqueOrThrow({ where: { id: rowId } })).status,
    ).toBe("rejected");
  });
  it("keeps pending state on remote failure and reuses the same idempotency key", async () => {
    state.apply.mockRejectedValueOnce(new Error("network"));
    await expect(reviewMetadata([rowId], "approve")).rejects.toThrow("network");
    expect(
      (await state.client!.metadataAuditItem.findUniqueOrThrow({ where: { id: rowId } })).status,
    ).toBe("pending");
    await reviewMetadata([rowId], "approve");
    expect(state.apply.mock.calls[0][3]).toBe(state.apply.mock.calls[1][3]);
  });
  it("rejects without remote writes and blocks new approvals while paused", async () => {
    await saveTaggingSettings(state.team.id, DEFAULT_TAGGING_SETTINGS);
    await expect(reviewMetadata([rowId], "approve")).rejects.toThrow("paused");
    await reviewMetadata([rowId], "reject");
    expect(state.apply).not.toHaveBeenCalled();
  });
  it("includes metadata-only assets in the unified SQL count and page", async () => {
    const result = await fetchAssetsWithAuditItems(1, 10, "pending");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(1);
      expect(result.data.assets).toHaveLength(1);
      expect(result.data.assets[0].batch).toEqual([]);
      expect(result.data.assets[0].metadataReviews?.[0].id).toBe(rowId);
    }
  });
  it("serializes competing decisions after the first approval has acquired the row lock", async () => {
    let start!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    state.apply.mockImplementation(async () => { start(); await hold; return { applied: ["f"], skipped: [] }; });
    const first = reviewMetadata([rowId], "approve");
    await started;
    const others = Promise.all([reviewMetadata([rowId], "approve"), reviewMetadata([rowId], "reject")]);
    release();
    await Promise.all([first, others]);
    expect(state.apply).toHaveBeenCalledTimes(1);
    expect((await state.client!.metadataAuditItem.findUniqueOrThrow({ where: { id: rowId } })).status).toBe("approved");
  });
  it("processes field-only review tasks without a tag tree and persists field results", async () => {
    state.predict.mockResolvedValue([prediction]);
    const seed = await state.client!.metadataAuditItem.findUniqueOrThrow({
      where: { id: rowId },
      include: { assetObject: true },
    });
    const queue = await state.client!.taggingQueueItem.create({
      data: {
        teamId: state.team.id,
        assetObjectId: seed.assetObjectId,
        status: "processing",
        extra: { featureClassify: false },
      },
    });
    try {
      await processQueueItem({
        ...queue,
        assetObject: seed.assetObject,
        tagsTreeLoader: async () => {
          throw new Error("Tag tree must not be needed");
        },
      });
      const result = await state.client!.taggingQueueItem.findUniqueOrThrow({
        where: { id: queue.id },
        include: { metadataAuditItems: true, taggingAuditItems: true },
      });
      expect(result.status).toBe("completed");
      expect(result.metadataAuditItems[0].status).toBe("pending");
      expect(result.taggingAuditItems).toEqual([]);
      expect(result.result).toMatchObject({ metadataPredictions: [prediction] });
      expect(state.apply).not.toHaveBeenCalled();
    } finally {
      await state.client!.taggingQueueItem.delete({ where: { id: queue.id } });
    }
  });
  it("direct field-only mode applies once without generating tag reviews", async () => {
    await saveTaggingSettings(state.team.id, {
      ...DEFAULT_TAGGING_SETTINGS,
      isMetadataEnabled: true,
      taggingMode: "direct",
    });
    state.predict.mockResolvedValue([prediction]);
    const seed = await state.client!.metadataAuditItem.findUniqueOrThrow({
      where: { id: rowId },
      include: { assetObject: true },
    });
    const queue = await state.client!.taggingQueueItem.create({
      data: {
        teamId: state.team.id,
        assetObjectId: seed.assetObjectId,
        status: "processing",
        extra: { featureClassify: false },
      },
    });
    try {
      await processQueueItem({ ...queue, assetObject: seed.assetObject });
      const result = await state.client!.taggingQueueItem.findUniqueOrThrow({
        where: { id: queue.id },
        include: { metadataAuditItems: true, taggingAuditItems: true },
      });
      expect(result.status).toBe("completed");
      expect(result.metadataAuditItems[0].status).toBe("approved");
      expect(result.taggingAuditItems).toEqual([]);
      expect(state.apply).toHaveBeenCalledTimes(1);
    } finally {
      await state.client!.taggingQueueItem.delete({ where: { id: queue.id } });
    }
  });
  it("completes field-only tasks with no eligible result instead of reporting a missing tag tree", async () => {
    const seed = await state.client!.metadataAuditItem.findUniqueOrThrow({
      where: { id: rowId },
      include: { assetObject: true },
    });
    const queue = await state.client!.taggingQueueItem.create({
      data: {
        teamId: state.team.id,
        assetObjectId: seed.assetObjectId,
        status: "processing",
        extra: { featureClassify: false },
      },
    });
    try {
      await processQueueItem({ ...queue, assetObject: seed.assetObject });
      expect(
        (await state.client!.taggingQueueItem.findUniqueOrThrow({ where: { id: queue.id } }))
          .status,
      ).toBe("completed");
    } finally {
      await state.client!.taggingQueueItem.delete({ where: { id: queue.id } });
    }
  });
  it("durably queues failed settings audit delivery and retries the original actor and before/after values", async () => {
    state.auditRequest.mockRejectedValueOnce(new Error("offline"));
    await saveTaggingSettings(state.team.id, DEFAULT_TAGGING_SETTINGS, "u/7");
    const events = await state.client!.teamConfig.findMany({
      where: { teamId: state.team.id, key: { startsWith: "metadataSettingAudit:" } },
    });
    expect(events).toHaveLength(1);
    expect(events[0].value).toMatchObject({ actorUserId: "7", before: true, after: false });
    await flushMetadataSettingAudits(state.team.id);
    expect(
      await state.client!.teamConfig.count({
        where: { teamId: state.team.id, key: { startsWith: "metadataSettingAudit:" } },
      }),
    ).toBe(0);
    expect(state.auditRequest.mock.calls[0][1].body.requestId).toBe(
      state.auditRequest.mock.calls[1][1].body.requestId,
    );
  });
  it("marks removed or changed fields unavailable", async () => {
    state.context.mockResolvedValue({ enabled: true, fields: [{ fieldId: "f", fieldVersion: 3 }] });
    expect((await fetchMetadataReviews()).rows[0].available).toBe(false);
  });
});
