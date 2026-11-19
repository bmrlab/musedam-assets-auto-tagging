// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), session: vi.fn(), settings: vi.fn(), permission: vi.fn(), suspended: vi.fn(), output: vi.fn(),
}));
vi.mock("@/app/(auth)/requestAuth", () => ({
  AUTH_TOKEN_HEADER: "x-auth-token",
  AuthTokenError: class extends Error {},
  getAuthSession: mocks.session,
  resolveTokenIdentity: vi.fn(),
}));
vi.mock("@/app/(tagging)/application-scope", () => ({ buildAllowedFolderIdSet: mocks.scope }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/app/(auth)/lib", () => ({ checkUserPermission: mocks.permission }));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: mocks.settings }));
vi.mock("@/lib/tagging/team-suspension", () => ({ isTeamTaggingSuspended: mocks.suspended }));
vi.mock("@/musedam/metadata", () => ({ hasEnabledTaggingOutput: mocks.output }));
import { GET } from "@/app/api/team/settings/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue(null);
  mocks.session.mockResolvedValue({ user: { slug: "u/1" }, team: { id: 42, slug: "t/155340" } });
  mocks.settings.mockResolvedValue({ triggerTiming: { manualTriggerTagging: true }, isMetadataEnabled: true });
  mocks.permission.mockResolvedValue(undefined);
  mocks.output.mockResolvedValue(true);
  mocks.suspended.mockResolvedValue(false);
});

it("hides manual tagging for a suspended team without querying output entitlements", async () => {
  mocks.suspended.mockResolvedValue(true);
  expect((await (await GET()).json()).data).toMatchObject({ manualTriggerTagging: false, hasPermission: true });
  expect(mocks.suspended).toHaveBeenCalledWith(42);
  expect(mocks.output).not.toHaveBeenCalled();
});

it("offers manual tagging again after suspension is lifted", async () => {
  mocks.suspended.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await (await GET()).json()).data.manualTriggerTagging).toBe(false);
  expect((await (await GET()).json()).data.manualTriggerTagging).toBe(true);
});

it("keeps the user's manual trigger setting when the team is active", async () => {
  mocks.settings.mockResolvedValue({ triggerTiming: { manualTriggerTagging: false } });
  expect((await (await GET()).json()).data.manualTriggerTagging).toBe(false);
});
