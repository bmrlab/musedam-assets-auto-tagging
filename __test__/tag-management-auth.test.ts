// @vitest-environment node
import { withTagManagementAuth } from "@/app/tags/tagManagementAuth";
import { issueTagManagementProof } from "@/lib/tagging/tag-management-proof";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ proof: null as string | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (ctx: unknown) => unknown) =>
    run({ team: { id: 7, slug: "t/77" }, user: { id: 9, slug: "u/99" } }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mocks.proof ? { "x-tag-management-proof": mocks.proof } : {}),
}));

beforeEach(() => {
  mocks.proof = null;
  vi.stubEnv("CIPHER_PASSWORD", "test-only-signing-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("rejects missing and forged browser claims before writing", async () => {
  for (const proof of [
    null,
    "true",
    JSON.stringify({ canManageTags: true }),
    "invalid.signature",
  ]) {
    mocks.proof = proof;
    const write = vi.fn();
    expect(await withTagManagementAuth(write)).toMatchObject({ success: false, code: "forbidden" });
    expect(write).not.toHaveBeenCalled();
  }
});
it("accepts only a server-issued proof for this session user and team", async () => {
  const write = vi.fn(async () => ({ success: true as const, data: undefined }));
  mocks.proof = issueTagManagementProof(9, 7).proof;
  expect(await withTagManagementAuth(write)).toMatchObject({ success: true });
  expect(write).toHaveBeenCalledOnce();
  for (const [user, team] of [
    [10, 7],
    [9, 8],
  ]) {
    mocks.proof = issueTagManagementProof(user, team).proof;
    expect(await withTagManagementAuth(write)).toMatchObject({ success: false });
  }
  expect(write).toHaveBeenCalledOnce();
});
it("rejects expired proof in a new request, while nested saving uses the already checked authorization", async () => {
  vi.useFakeTimers();
  mocks.proof = issueTagManagementProof(9, 7).proof;
  expect(
    await withTagManagementAuth(async () => {
      vi.advanceTimersByTime(31_000);
      return withTagManagementAuth(async () => ({ success: true, data: undefined }));
    }),
  ).toMatchObject({ success: true });
  expect(
    await withTagManagementAuth(async () => ({ success: true, data: undefined })),
  ).toMatchObject({ success: false });
});

it("rejects a valid proof whose user/team payload has been tampered with", async () => {
  const [payload, signature] = issueTagManagementProof(10, 8).proof.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  decoded.userId = 9; decoded.teamId = 7;
  mocks.proof = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
  const write = vi.fn();
  expect(await withTagManagementAuth(write)).toMatchObject({ success: false });
  expect(write).not.toHaveBeenCalled();
});
