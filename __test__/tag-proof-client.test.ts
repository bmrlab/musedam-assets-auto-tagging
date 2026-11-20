import { requestTagManagementProof } from "@/lib/tag-management-client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: mocks.dispatch }));
beforeEach(() => vi.resetAllMocks());
it("uses the existing parent permission action with bounded waiting", async () => {
  mocks.dispatch.mockResolvedValue({
    canManageTags: true,
    proof: "signed",
    expiresAt: Date.now() + 30_000,
  });
  expect(await requestTagManagementProof("app-test")).toBe("signed");
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(
    "get-tag-management-permission",
    { appAuthToken: "app-test" },
    { timeoutMs: 15_000 },
  );
});
it.each([
  { canManageTags: true },
  { canManageTags: false, proof: "claim", expiresAt: 9999999999999 },
  { canManageTags: true, proof: "expired", expiresAt: 0 },
])("rejects plain browser booleans and expired proof: %j", async (result) => {
  mocks.dispatch.mockResolvedValue(result);
  expect(await requestTagManagementProof("app-test")).toBeNull();
});
it("fails closed on parent errors/timeouts", async () => {
  mocks.dispatch.mockRejectedValue(new Error("timeout"));
  expect(await requestTagManagementProof("app-test")).toBeNull();
});
