// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTeam: vi.fn(),
  findConfig: vi.fn(),
  settings: vi.fn(),
  assets: vi.fn(),
}));
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
        creditCost: (enabled ? 2 : 1) + 11 * (videoEnabled ? 2 : 1),
        videoUnitCreditCost: videoEnabled ? 2 : 1,
        unitCreditCost: enabled ? 2 : 1,
        creditPricingVersion: "video-duration-v1",
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

  it.each(["suspended", "disabled"])("quotes zero when tagging is %s", async (reason) => {
    if (reason === "suspended") mocks.findConfig.mockResolvedValue({ value: true });
    mocks.settings.mockResolvedValue({
      isTaggingEnabled: false,
      isMetadataEnabled: false,
      featureImageMode: true,
    });
    const body = await (await POST(request())).json();
    expect(body).toMatchObject({ success: true, data: { creditCost: 0, featureImageMode: true } });
    if (reason === "suspended") expect(fetchMock).not.toHaveBeenCalled();
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
  expect((await (await POST(request(["1"]))).json()).data).toMatchObject({ creditCost: 3, unitCreditCost: 2, videoUnitCreditCost: 1, featureVideoImageMode: false });
});
