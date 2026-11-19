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

it("publishes team defaults and expanded folder scope without writing settings", async () => {
  mocks.scope.mockResolvedValue(new Set(["10", "11"]));
  const defaults = { recognitionAccuracy: "precise", matchingSources: { basicInfo: false, materializedPath: true, contentAnalysis: true, tagKeywords: false }, featureImageMode: true, featureVideoImageMode: false };
  mocks.settings.mockResolvedValue({ ...defaults, triggerTiming: { manualTriggerTagging: true }, applicationScope: { scopeType: "specific", selectedFolders: [] } });
  expect((await (await GET()).json()).data.manualTaggingDefaults).toEqual({ ...defaults, allowedFolderIds: ["10", "11"] });
});
