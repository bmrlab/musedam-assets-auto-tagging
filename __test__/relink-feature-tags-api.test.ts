import { POST } from "@/app/api/feature-library/relink-tags/route";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  isAdmin: vi.fn(),
  relink: vi.fn(),
}));
vi.mock("@/app/(auth)/authOptions", () => ({ default: {} }));
vi.mock("@/app/(auth)/lib", () => ({ checkUserPermission: mocks.permission }));
vi.mock("@/lib/admin", () => ({ isAdminUserSlug: mocks.isAdmin }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/logging", () => ({ rootLogger: { error: vi.fn() } }));
vi.mock("@/lib/tagging/relink-feature-tags", () => ({ relinkFeatureTags: mocks.relink }));
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/feature-library/relink-tags", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 1, slug: "user" }, team: { id: 7, slug: "team" } });
  mocks.permission.mockResolvedValue({});
  mocks.isAdmin.mockReturnValue(true);
  mocks.relink.mockResolvedValue({ dryRun: true, results: [] });
});
describe("POST relink feature tags", () => {
  it("defaults to a product preview in the authenticated team", async () => {
    expect((await POST(request({}))).status).toBe(200);
    expect(mocks.relink).toHaveBeenCalledWith(7, ["product"], true);
    expect(mocks.isAdmin).toHaveBeenCalledWith("user");
  });
  it("accepts explicit execution and deduplicates library types", async () => {
    expect(
      (await POST(request({ dryRun: false, types: ["product", "brand", "product"] }))).status,
    ).toBe(200);
    expect(mocks.relink).toHaveBeenCalledWith(7, ["product", "brand"], false);
  });
  it("rejects unauthenticated and unauthorized requests before doing any work", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request({}))).status).toBe(401);
    mocks.permission.mockRejectedValueOnce(new Error("denied"));
    expect((await POST(request({}))).status).toBe(403);
    expect(mocks.relink).not.toHaveBeenCalled();
  });
  it.each([true, false])("rejects non-admin requests when dryRun=%s", async (dryRun) => {
    mocks.isAdmin.mockReturnValue(false);
    // Even a stale session flag cannot bypass the server-side admin check.
    mocks.session.mockResolvedValue({
      user: { id: 1, slug: "user", isAdmin: true },
      team: { id: 7, slug: "team" },
    });
    const response = await POST(request({ dryRun }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, message: "Forbidden: admin only" });
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.relink).not.toHaveBeenCalled();
  });
  it("rejects team overrides and invalid input", async () => {
    for (const body of [
      { teamId: 8 },
      { dryRun: "false" },
      { types: [] },
      { types: ["unknown"] },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(
      (await POST(new NextRequest("http://localhost/api", { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect(mocks.relink).not.toHaveBeenCalled();
  });
  it("reports transaction conflicts for retry", async () => {
    mocks.relink.mockRejectedValue({ code: "P2034" });
    expect((await POST(request({ dryRun: false }))).status).toBe(409);
  });
});
