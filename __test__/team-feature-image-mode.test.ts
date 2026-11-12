// @vitest-environment node
import {
  getTaggingSettings,
  resetTaggingSettings,
  saveTaggingSettings,
} from "@/app/(tagging)/tagging/settings/lib";
import {
  DEFAULT_TAGGING_SETTINGS,
  TAGGING_CONFIG_KEYS,
  taggingSettingsSchema,
} from "@/app/(tagging)/types";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ configs: new Map<string, unknown>(), upsert: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    teamConfig: {
      findMany: async ({ where }: { where: { teamId: number; key: { in: string[] } } }) =>
        where.key.in.flatMap((key) =>
          mocks.configs.has(`${where.teamId}:${key}`)
            ? [{ key, value: mocks.configs.get(`${where.teamId}:${key}`) }]
            : [],
        ),
    },
    $transaction: async (run: (tx: unknown) => unknown) =>
      run({ teamConfig: { upsert: mocks.upsert } }),
  },
}));
beforeEach(() => {
  mocks.configs.clear();
  vi.clearAllMocks();
  mocks.upsert.mockImplementation(async ({ where, update }) => {
    const { teamId, key } = where.teamId_key;
    mocks.configs.set(`${teamId}:${key}`, update.value);
  });
});
it("defaults off for an unconfigured team and ignores malformed boolean data", async () => {
  expect((await getTaggingSettings(1)).featureImageMode).toBe(false);
  mocks.configs.set(`1:${TAGGING_CONFIG_KEYS.FEATURE_IMAGE_MODE}`, "true");
  expect((await getTaggingSettings(1)).featureImageMode).toBe(false);
  expect(taggingSettingsSchema.shape.featureImageMode.safeParse("true").success).toBe(false);
});
it("stores the image mode in existing TeamConfig and isolates teams", async () => {
  await saveTaggingSettings(1, { ...DEFAULT_TAGGING_SETTINGS, featureImageMode: true });
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { teamId_key: { teamId: 1, key: "featureImageMode" } },
      create: { teamId: 1, key: "featureImageMode", value: true },
      update: { value: true },
    }),
  );
  expect((await getTaggingSettings(1)).featureImageMode).toBe(true);
  expect((await getTaggingSettings(2)).featureImageMode).toBe(false);
  await resetTaggingSettings(1);
  expect((await getTaggingSettings(1)).featureImageMode).toBe(false);
});
it("preserves the setting when an older client omits the new field", async () => {
  await saveTaggingSettings(1, { ...DEFAULT_TAGGING_SETTINGS, featureImageMode: true });
  const legacy = { ...DEFAULT_TAGGING_SETTINGS };
  delete (legacy as Partial<typeof legacy>).featureImageMode;
  await saveTaggingSettings(1, legacy);
  expect((await getTaggingSettings(1)).featureImageMode).toBe(true);
});

it("does not inherit legacy image mode for video and preserves video when old clients save", async () => {
  mocks.configs.set(`1:${TAGGING_CONFIG_KEYS.FEATURE_IMAGE_MODE}`, true);
  expect((await getTaggingSettings(1)).featureImageMode).toBe(true);
  expect((await getTaggingSettings(1)).featureVideoImageMode).toBe(false);
  await saveTaggingSettings(1, {
    ...DEFAULT_TAGGING_SETTINGS,
    featureImageMode: false,
    featureVideoImageMode: true,
  });
  const legacy = { ...DEFAULT_TAGGING_SETTINGS, featureImageMode: true };
  delete legacy.featureVideoImageMode;
  await saveTaggingSettings(1, legacy);
  expect(await getTaggingSettings(1)).toMatchObject({
    featureImageMode: true,
    featureVideoImageMode: true,
  });
  expect((await getTaggingSettings(2)).featureVideoImageMode).toBe(false);
  expect(taggingSettingsSchema.shape.featureVideoImageMode.safeParse("true").success).toBe(false);
  await resetTaggingSettings(1);
  expect(await getTaggingSettings(1)).toMatchObject({
    featureImageMode: false,
    featureVideoImageMode: false,
  });
});
