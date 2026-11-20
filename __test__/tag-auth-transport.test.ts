import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/tag-management-client", () => ({ requestTagManagementProof: mocks.exchange }));
const originalFetch = window.fetch;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/tags");
  window.fetch = mocks.fetch;
  mocks.fetch.mockResolvedValue(new Response("ok"));
  mocks.exchange.mockResolvedValue("scoped-proof");
  const auth = await import("@/lib/auth-token");
  auth.setAuthToken("app-test");
  auth.installAuthFetch();
});
afterEach(() => {
  window.fetch = originalFetch;
  window.sessionStorage.clear();
});

it("attaches scoped proof to the tag page server action, with the current application credential", async () => {
  await window.fetch("/tags", { method: "POST", headers: { "next-action": "action-id" } });
  expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("app-test");
  const headers = mocks.fetch.mock.calls[0][1].headers as Headers;
  expect(headers.get("x-tag-management-proof")).toBe("scoped-proof");
  expect(headers.get("x-auth-token")).toBe("app-test");
});
it("does not attach browser claims when an older parent cannot issue proof", async () => {
  mocks.exchange.mockResolvedValue(null);
  await window.fetch("/tags", { method: "POST", headers: { "next-action": "action-id" } });
  expect(mocks.fetch.mock.calls[0][1].headers.has("x-tag-management-proof")).toBe(false);
});
it("does not send credentials to other origins or ask for tag authority for reads/other pages", async () => {
  await window.fetch("https://unrelated.example/api");
  expect(mocks.fetch.mock.calls[0][1]).toBeUndefined();
  await window.fetch("/api/auth/me");
  window.history.replaceState(null, "", "/tagging/review");
  await window.fetch("/tagging/review", {
    method: "POST",
    headers: { "next-action": "other-action" },
  });
  expect(mocks.exchange).not.toHaveBeenCalled();
});
it("uses the new team credential after a tab switches teams", async () => {
  const auth = await import("@/lib/auth-token");
  auth.setAuthToken("new-team-test");
  await window.fetch("/tags", { method: "POST", headers: { "next-action": "action-id" } });
  expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("new-team-test");
});

it("attaches proof to the fixed JSON sort endpoint without a Next-Action header", async () => {
  await window.fetch("/api/tags/sort", { method: "POST", body: JSON.stringify({ tags: [] }) });
  expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("app-test");
  expect(mocks.fetch.mock.calls[0][1].headers.get("x-tag-management-proof")).toBe("scoped-proof");
});
it("authorizes import writes while keeping status polling read-only", async () => {
  await window.fetch("/api/tags/imports", { method: "POST", body: "{}" });
  expect(mocks.exchange).toHaveBeenCalledOnce();
  expect(mocks.fetch.mock.calls[0][1].headers.get("x-tag-management-proof")).toBe("scoped-proof");
  await window.fetch("/api/tags/imports?jobId=42");
  expect(mocks.exchange).toHaveBeenCalledOnce();
});
