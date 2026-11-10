// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTeam: vi.fn(),
  findConfig: vi.fn(),
  settings: vi.fn(),
  syncAsset: vi.fn(),
  enqueue: vi.fn(),
  scope: vi.fn(),
  inScope: vi.fn(),
  findTask: vi.fn(),
  findTasks: vi.fn(),
  updateTask: vi.fn(),
  deleteAudits: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $transaction: mocks.transaction,
    taggingAuditItem: { deleteMany: mocks.deleteAudits },
    team: { findUnique: mocks.findTeam },
    teamConfig: { findUnique: mocks.findConfig },
    taggingQueueItem: {
      findFirst: mocks.findTask,
      findMany: mocks.findTasks,
      update: mocks.updateTask,
    },
  },
}));
vi.mock("@/lib/logging", () => ({ rootLogger: { error: vi.fn() } }));
vi.mock("@/app/(tagging)/queue", () => ({ enqueueTaggingTask: mocks.enqueue }));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: mocks.settings }));
vi.mock("@/musedam/assets", () => ({ syncSingleAssetFromMuseDAM: mocks.syncAsset }));
vi.mock("@/app/(tagging)/application-scope", () => ({
  buildAllowedFolderIdSet: mocks.scope,
  isAssetInApplicationScope: mocks.inScope,
}));

import { POST as batch } from "@/app/(tagging)/api/tagging/predct-asset-tag-batch/route";
import { POST as single } from "@/app/(tagging)/api/tagging/predict-asset-tag/route";

const fetchMock = vi.fn();
const request = () =>
  new NextRequest("https://example.test/api/tagging", {
    method: "POST",
    body: JSON.stringify({ teamId: "158057", assetId: "123", assetIds: [123] }),
  });
const success = () =>
  new Response(
    JSON.stringify({
      code: 0,
      result: {
        apiKey: "team-key",
        expiresAt: "2055-08-19 16:13:25",
      },
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("MUSEDAM_APP_API_KEY", "app-id");
  vi.stubEnv("MUSEDAM_APP_SECRET", "app-secret");
  vi.stubEnv("MUSEDAM_API_BASE_URL", "https://open.example.test");
  mocks.findTeam.mockResolvedValue({ id: 42, slug: "t/158057" });
  // Existing credentials must never bypass the live authorization check.
  mocks.findConfig.mockResolvedValue({ value: { apiKey: "cached-key", expiresAt: "2055-01-01" } });
  mocks.settings.mockResolvedValue({
    isTaggingEnabled: true,
    triggerTiming: {
      autoRealtimeTagging: true,
      scheduledTagging: true,
    },
    applicationScope: {},
  });
  mocks.syncAsset.mockResolvedValue({
    assetObject: { id: 7, teamId: 42 },
    musedamAsset: { parentIds: [] },
  });
  mocks.inScope.mockReturnValue(true);
  mocks.enqueue.mockResolvedValue({ id: 99, status: "pending" });
  mocks.findTask.mockResolvedValue(null);
  mocks.findTasks.mockResolvedValue([]);
  fetchMock.mockImplementation(async () => success());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

for (const [name, post] of [
  ["single", single],
  ["batch", batch],
] as const) {
  describe(`${name} tagging authorization`, () => {
    it.each([
      ["HTTP error", () => Promise.resolve(new Response("Forbidden", { status: 403 }))],
      [
        "expired team",
        () =>
          Promise.resolve(
            new Response(JSON.stringify({ code: "20045", message: "团队不存在或已到期！" })),
          ),
      ],
      ["network error", () => Promise.reject(new Error("connection failed"))],
      ["invalid JSON", () => Promise.resolve(new Response("invalid"))],
      [
        "missing credentials in response",
        () => Promise.resolve(new Response(JSON.stringify({ code: 0, result: {} }))),
      ],
    ])("blocks %s before syncing or changing tasks", async (_name, response) => {
      fetchMock.mockImplementation(response);
      const res = await post(request());
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ success: false });
      expect(mocks.settings).not.toHaveBeenCalled();
      expect(mocks.syncAsset).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
      expect(mocks.findTask).not.toHaveBeenCalled();
      expect(mocks.updateTask).not.toHaveBeenCalled();
      expect(mocks.findConfig).not.toHaveBeenCalled();
    });

    it("fails closed when application credentials are missing", async () => {
      vi.stubEnv("MUSEDAM_APP_SECRET", "");
      expect((await post(request())).status).toBe(502);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("exchanges credentials for the requested team on every request", async () => {
      expect((await post(request())).status).toBe(200);
      expect((await post(request())).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://open.example.test/api/apps/exchange-api-key",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Basic ${Buffer.from("app-id:app-secret").toString("base64")}`,
          }),
          body: JSON.stringify({ orgId: "158057" }),
        }),
      );
      expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    });
  });
}


describe("single tagging creditCost", () => {
  it.each([false, true])("returns the new task price for image mode %s", async enabled => {
    const settings = await mocks.settings();
    mocks.settings.mockResolvedValue({ ...settings, featureImageMode: enabled });
    const data = (await (await single(request())).json()).data;
    expect(data).toMatchObject({ queueItemId: 99, creditCost: enabled ? 2 : 1 });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ featureImageMode: enabled }));
  });

  it.each(["disabled", "realtime disabled", "out of scope"])("returns zero when %s", async reason => {
    const settings = await mocks.settings();
    mocks.settings.mockResolvedValue({
      ...settings,
      featureImageMode: true,
      isTaggingEnabled: reason !== "disabled",
      triggerTiming: { autoRealtimeTagging: reason !== "realtime disabled" },
    });
    mocks.inScope.mockReturnValue(reason !== "out of scope");
    expect((await (await single(request())).json()).data).toMatchObject({ queueItemId: null, creditCost: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not charge or revive a cancelled default task", async () => {
    mocks.findTask.mockResolvedValue({ id: 12, status: "failed", result: { error: "CANCELLED" } });
    expect((await (await single(request())).json()).data).toMatchObject({ queueItemId: null, creditCost: 0 });
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["pending", "processing", "completed", "failed"])("does not charge a duplicate %s task and preserves its snapshot", async status => {
    mocks.settings.mockResolvedValue({ ...(await mocks.settings()), featureImageMode: false });
    mocks.findTask.mockResolvedValue({ id: 12, status, extra: { featureImageMode: true, creditCost: 2 } });
    expect((await (await single(request())).json()).data).toMatchObject({ queueItemId: null, creditCost: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    if (status !== "pending") {
      expect(mocks.updateTask).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ extra: expect.objectContaining({ featureImageMode: true, creditCost: 2 }) }),
      }));
    }
  });
});
