// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTeam: vi.fn(),
  findConfig: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    team: { findUnique: mocks.findTeam },
    teamConfig: { findUnique: mocks.findConfig },
  },
}));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: mocks.settings }));

import { POST } from "@/app/(tagging)/api/tagging/credit-quote/route";

const fetchMock = vi.fn();
const request = () =>
  new NextRequest("https://example.test/api/tagging/credit-quote", {
    method: "POST",
    body: JSON.stringify({ teamId: "158057" }),
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
