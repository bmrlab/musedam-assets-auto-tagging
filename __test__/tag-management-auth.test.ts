// @vitest-environment node
import { withTagManagementAuth } from "@/app/tags/tagManagementAuth";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (ctx: unknown) => unknown) =>
    run({
      team: { id: 7, slug: "t/77" },
      user: { id: 9, slug: "u/99" },
    }),
}));
vi.mock("@/musedam/user", () => ({ fetchMuseDAMUser: mocks.member }));

beforeEach(() => vi.resetAllMocks());

it.each([
  { canManageTags: false, roleCode: "admin" },
  { roleCode: "admin" },
  { canManageTags: "true", roleCode: "content" },
])("rejects missing or false permission regardless of role: %j", async (member) => {
  mocks.member.mockResolvedValue(member);
  const write = vi.fn();
  expect(await withTagManagementAuth(write)).toMatchObject({ success: false, code: "forbidden" });
  expect(write).not.toHaveBeenCalled();
});

it("checks the actual session user in the actual session team", async () => {
  mocks.member.mockResolvedValue({ canManageTags: true, roleCode: "custom" });
  const write = vi.fn(async () => ({ success: true as const, data: undefined }));
  expect(await withTagManagementAuth(write)).toMatchObject({ success: true });
  expect(mocks.member.mock.calls[0][0].team).toEqual({ id: 7, slug: "t/77" });
  expect(mocks.member.mock.calls[0][0].musedamUserId.toString()).toBe("99");
  expect(write).toHaveBeenCalledOnce();
});

it("fails closed when permission lookup fails", async () => {
  mocks.member.mockRejectedValue(new Error("offline"));
  const write = vi.fn();
  expect(await withTagManagementAuth(write)).toMatchObject({ success: false, code: "forbidden" });
  expect(write).not.toHaveBeenCalled();
});
