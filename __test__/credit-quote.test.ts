// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), findTeam: vi.fn(),
  findConfig: vi.fn(),
  settings: vi.fn(),
  assets: vi.fn(),
}));
vi.mock("@/app/(tagging)/application-scope", async (importOriginal) => ({ ...await importOriginal<typeof import("@/app/(tagging)/application-scope")>(), buildAllowedFolderIdSet: mocks.scope }));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    team: { findUnique: mocks.findTeam },
    teamConfig: { findUnique: mocks.findConfig },
  },
}));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: mocks.settings }));
vi.mock("@/musedam/asset-credit-quote", () => ({ fetchAssetCreditInputs: mocks.assets }));

import { POST } from "@/app/(tagging)/api/tagging/credit-quote/route";

const fetchMock = vi.fn();
const request = (assetIds?: string[]) =>
  new NextRequest("https://example.test/api/tagging/credit-quote", {
    method: "POST",
    body: JSON.stringify({ teamId: "158057", assetIds }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue(null);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("MUSEDAM_APP_API_KEY", "app-id");
  vi.stubEnv("MUSEDAM_APP_SECRET", "app-secret");
  vi.stubEnv("MUSEDAM_API_BASE_URL", "https://open.example.test");
  mocks.findTeam.mockResolvedValue({ id: 42, slug: "t/158057" });
  mocks.findConfig.mockResolvedValue(null);
  mocks.settings.mockResolvedValue({
    isTaggingEnabled: true,
    isMetadataEnabled: false,
    featureImageMode: false,
  });
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ code: 0, result: { apiKey: "team-key", expiresAt: "2055-08-19 16:13:25" } }),
    ),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("credit quote", () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])(
    "sums mixed assets for image mode %s and video mode %s",
    async (enabled, videoEnabled) => {
      mocks.settings.mockResolvedValue({ isTaggingEnabled: true, featureImageMode: enabled, featureVideoImageMode: videoEnabled });
      mocks.assets.mockResolvedValue([
        { extra: { extension: "jpg" } },
        { extra: { extension: "mp4", duration: 5000 } },
        { extra: { extension: "mov", duration: 60000 } },
      ]);
      const body = await (await POST(request(["1", "2", "3", "1"]))).json();
      expect(body.data).toMatchObject({
        creditCost: (enabled ? 2 : 1) + (videoEnabled ? 22 : 2),
        videoUnitCreditCost: videoEnabled ? 2 : 1,
        unitCreditCost: enabled ? 2 : 1,
        creditPricingVersion: "video-duration-v2",
      });
      expect(mocks.assets).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), [
        BigInt(1),
        BigInt(2),
        BigInt(3),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects unavailable metadata instead of returning an image price for unknown assets", async () => {
    mocks.assets.mockRejectedValue(new Error("missing asset"));
    expect((await POST(request(["1"]))).status).toBe(502);
  });

  it("quotes an empty selection as zero without fetching assets", async () => {
    expect((await (await POST(request([]))).json()).data.creditCost).toBe(0);
    expect(mocks.assets).not.toHaveBeenCalled();
  });
  it.each([
    [false, 1],
    [true, 2],
  ])("quotes image mode %s as %s point without enqueueing", async (enabled, cost) => {
    mocks.settings.mockResolvedValue({
      isTaggingEnabled: true,
      isMetadataEnabled: false,
      featureImageMode: enabled,
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { featureImageMode: enabled, creditCost: cost },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { assetIds: [] },
    { assetIds: ["1"] },
    { assetIds: ["1"], checkApplicationScope: true },
  ])("rejects suspended quotation without advertising a free task: %j", async (options) => {
    mocks.findConfig.mockResolvedValue({ value: true });
    const response = await POST(new NextRequest("https://example.test/api/tagging/credit-quote", {
      method: "POST",
      body: JSON.stringify({ teamId: "158057", ...options }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      code: "TEAM_TAGGING_SUSPENDED",
      error: "Tagging is suspended for this team",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.assets).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
  });

  it("quotes zero when all tagging outputs are disabled", async () => {
    mocks.settings.mockResolvedValue({
      isTaggingEnabled: false,
      isMetadataEnabled: false,
      featureImageMode: true,
    });
    const body = await (await POST(request())).json();
    expect(body).toMatchObject({ success: true, data: { creditCost: 0, featureImageMode: true } });
  });

  it("returns team-not-found without quoting a price", async () => {
    mocks.findTeam.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: "Team not found" });
    expect(mocks.settings).not.toHaveBeenCalled();
  });
});

it("defaults legacy teams to text-only video quotes even when image mode is on", async () => {
  mocks.settings.mockResolvedValue({ isTaggingEnabled: true, featureImageMode: true });
  mocks.assets.mockResolvedValue([{ extra: { extension: "mp4", duration: 5000 } }]);
  expect((await (await POST(request(["1"]))).json()).data).toMatchObject({ creditCost: 1, unitCreditCost: 2, videoUnitCreditCost: 1, featureVideoImageMode: false });
});

const scopeRequest = () => new NextRequest("https://example.test/api/tagging/credit-quote", { method: "POST", body: JSON.stringify({ teamId: "158057", assetIds: ["1", "2", "3"], checkApplicationScope: true }) });
it("quotes only filed assets in the selected folders, including any matching parent", async () => {
  mocks.scope.mockResolvedValue(new Set(["10", "11"]));
  mocks.assets.mockResolvedValue([
    { id: "1", parentIds: ["20", "11"], extra: { extension: "jpg" } },
    { id: "2", parentIds: ["20"], extra: { extension: "jpg" } },
    { id: "3", parentIds: [], extra: { extension: "jpg" } },
  ]);
  expect((await (await POST(scopeRequest())).json()).data).toMatchObject({ creditCost: 1, eligibleAssetIds: ["1"], excludedCount: 2 });
});
it("still reports scope for metadata-only teams with a zero quote", async () => {
  mocks.settings.mockResolvedValue({ isTaggingEnabled: false, isMetadataEnabled: true });
  mocks.assets.mockResolvedValue([{ id: "1", parentIds: ["10"] }, { id: "2", parentIds: [] }, { id: "3", parentIds: [] }]);
  expect((await (await POST(scopeRequest())).json()).data).toMatchObject({ creditCost: 0, eligibleAssetIds: ["1"], excludedCount: 2 });
});
it("rejects scope quotation if parent metadata is unavailable", async () => {
  mocks.assets.mockResolvedValue([{ id: "1", extra: { extension: "jpg" } }]);
  expect((await POST(scopeRequest())).status).toBe(502);
});
