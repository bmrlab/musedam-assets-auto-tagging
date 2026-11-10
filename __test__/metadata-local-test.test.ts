import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { predictMetadata } from "@/lib/metadata/predict";
import type { AssetObject } from "@/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: vi.fn() }));
vi.mock("@/app/(tagging)/predict", () => ({
  buildContentAnalysisText: vi.fn(),
  getTaggingPredictProviderOptions: vi.fn(),
  runWithTaggingModelFallback: vi.fn(),
}));
const { fetchContext } = vi.hoisted(() => ({ fetchContext: vi.fn() }));
vi.mock("@/musedam/metadata", () => ({ fetchMetadataContext: fetchContext }));

const team = { id: 1, slug: "t/135" };
const asset = (slug: string, extra: object) => ({ slug, extra }) as AssetObject;

describe("metadata context for matching-test uploads", () => {
  beforeEach(() => fetchContext.mockReset().mockResolvedValue({ enabled: true, fields: [] }));

  it("uses the team dictionary without treating a local upload UUID as a DAM ID", async () => {
    await expect(
      predictMetadata(
        asset("local-test-example", { localTest: true }),
        team,
        DEFAULT_TAGGING_SETTINGS,
      ),
    ).resolves.toEqual([]);
    expect(fetchContext).toHaveBeenCalledWith(team, undefined);
  });

  it("keeps the real material context for DAM assets", async () => {
    await predictMetadata(asset("a/6964802", {}), team, DEFAULT_TAGGING_SETTINGS);
    expect(fetchContext).toHaveBeenCalledWith(team, "6964802");
  });

  it("rejects malformed non-local asset IDs", async () => {
    await expect(
      predictMetadata(asset("local-test-example", {}), team, DEFAULT_TAGGING_SETTINGS),
    ).rejects.toThrow("Invalid slug");
    expect(fetchContext).not.toHaveBeenCalled();
  });
});
