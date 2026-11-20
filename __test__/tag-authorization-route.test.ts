// @vitest-environment node
import { OPTIONS, POST } from "@/app/api/tags/authorization/route";
import { verifyTagManagementProof } from "@/lib/tagging/tag-management-proof";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), check: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/requestAuth", () => ({ getAuthSession: mocks.session }));
vi.mock("@/musedam/tagManagementPermission", () => ({
  assertMainSiteTagManagementPermission: mocks.check,
}));
const request = (patch: Record<string, string> = {}) =>
  new NextRequest("https://auto.example/api/tags/authorization", {
    method: "POST",
    headers: {
      "x-auth-token": "app-test",
      "x-token": "main-test",
      "x-user-id": "99",
      "x-org-id": "77",
      ...patch,
    },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CIPHER_PASSWORD", "test-only-key");
  mocks.session.mockResolvedValue({ user: { id: 9, slug: "u/99" }, team: { id: 7, slug: "t/77" } });
  mocks.check.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("exchanges verified main credentials for a scoped proof without returning the login token", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(verifyTagManagementProof(body.proof, 9, 7)).toBe(true);
  expect(verifyTagManagementProof(body.proof, 9, 8)).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/main-test|app-test/);
  expect(mocks.check).toHaveBeenCalledExactlyOnceWith({
    userId: "99",
    teamId: "77",
    token: "main-test",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
const invalidHeaders: Record<string, string>[] = [{ "x-auth-token": "" }, { "x-token": "" }, { "x-user-id": "100" }, { "x-org-id": "88" }];
it.each(invalidHeaders)(
  "rejects missing credentials and mismatched user/team before gateway calls: %j",
  async (patch) => {
    expect((await POST(request(patch))).status).toBe(403);
    expect(mocks.check).not.toHaveBeenCalled();
  },
);
it("rejects an unauthenticated application session", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.check).not.toHaveBeenCalled();
});
it("never issues proof when the main gateway denies or fails, and does not echo secrets", async () => {
  mocks.check.mockRejectedValue(new Error("main-test internal response"));
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("main-test");
});
it("supports explicit-header CORS without ambient cookies", async () => {
  const response = await OPTIONS();
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.has("access-control-allow-credentials")).toBe(false);
});
