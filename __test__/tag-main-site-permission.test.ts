// @vitest-environment node
import { assertMainSiteTagManagementPermission } from "@/musedam/tagManagementPermission";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fetchMock = vi.fn();
const input = { userId: "99", teamId: "77", token: "test-session" };
const success = (result: unknown) => new Response(JSON.stringify({ code: 0, result }));
let org: { id: string; orgFeeType: number; valid: boolean };
let member: { userId: string; roleId: string | null; accountStatusEnum: string; visitor?: boolean };
let codes: string[], roles: Array<{ roleId: string; authList: Array<{ authCode: string }> }>;
beforeEach(() => {
  vi.stubEnv("MUSEDAM_WEB_API_BASE_URL", "https://main-api.example");
  vi.stubEnv("MUSEDAM_API_ENV_TAG", "");
  vi.stubGlobal("fetch", fetchMock);
  org = { id: "77", orgFeeType: 4, valid: true };
  member = { userId: "99", roleId: "3", accountStatusEnum: "NORMAL" };
  codes = ["dam-material-admin-management-tag"];
  roles = [{ roleId: "3", authList: [{ authCode: "ORG_TAG_GROUP_MODIFY" }] }];
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/org/77")) return success(org);
    if (url.endsWith("/org/members/99")) return success(member);
    if (url.endsWith("/orgRole/queryCurrentUserAuthCode")) return success(codes);
    if (url.endsWith("/org/universal/role-auth")) return success(roles);
    throw new Error("unexpected endpoint");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the existing user session and exact enterprise permission, without org-member-info", async () => {
  await assertMainSiteTagManagementPermission(input);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for (const [url, request] of fetchMock.mock.calls) {
    expect(url).toMatch(/^https:\/\/main-api\.example\/mini-dam-user\//);
    expect(request.headers).toMatchObject({
      "x-user-id": "99",
      "x-org-id": "77",
      "x-token": "test-session",
    });
    expect(request).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(url).not.toContain("org-member-info");
  }
});
it("uses the existing normal-team role permission instead of assuming an admin role", async () => {
  org.orgFeeType = 1;
  await assertMainSiteTagManagementPermission(input);
  roles[0].authList = [];
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow(
    "No tag management permission",
  );
});
it.each(["RESIGNED", "REMOVE", "QUIT", "PENDING_ACTIVATION", "API_KEY"])(
  "rejects inactive/non-user account %s",
  async (status) => {
    member.accountStatusEnum = status;
    await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  },
);
it("rejects expired teams, mismatched identities and visitors", async () => {
  org.valid = false;
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  org.valid = true;
  org.id = "88";
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  org.id = "77";
  member.userId = "100";
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  member.userId = "99";
  member.visitor = true;
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
});
it("does not accept another permission code or a browser permission boolean", async () => {
  codes = ["dam-material-extension-ai-auto-marking"];
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  fetchMock.mockImplementation(async () => success({ canManageTags: true }));
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
});
it.each([
  () => Promise.resolve(new Response("", { status: 401 })),
  () => Promise.resolve(new Response(JSON.stringify({ code: "denied", result: [] }))),
  () => Promise.reject(new Error("timeout")),
])("fails closed on gateway errors", async (failure) => {
  fetchMock.mockImplementation(failure);
  await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
});
it("rejects insecure or missing configured gateways before sending session credentials", async () => {
  for (const base of [
    "",
    "http://public.example",
    "https://user:pass@main.example",
    "https://main.example?next=evil",
  ]) {
    vi.stubEnv("MUSEDAM_WEB_API_BASE_URL", base);
    await expect(assertMainSiteTagManagementPermission(input)).rejects.toThrow();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
