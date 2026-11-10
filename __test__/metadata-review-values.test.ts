import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ values: vi.fn(), asset: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (action: (context: unknown) => unknown) =>
    action({ team: { id: 1, slug: "t/135" }, user: { id: 1 } }),
}));
vi.mock("@/app/(auth)/lib", () => ({ checkUserPermission: vi.fn() }));
vi.mock("@/musedam/metadata", () => ({
  fetchMetadataValues: transport.values,
  fetchMetadataContext: vi.fn(),
  applyMetadataPredictions: vi.fn(),
}));
vi.mock("@/prisma/prisma", () => ({
  default: { assetObject: { findFirstOrThrow: transport.asset } },
}));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: vi.fn() }));

import { fetchReviewMetadataValues } from "@/app/(tagging)/tagging/review/metadata-actions";
import { metadataDisplayValues } from "@/lib/metadata/display";

beforeEach(() => vi.clearAllMocks());
it("displays the real name-keyed records response, including false and cascade labels", async () => {
  transport.asset.mockResolvedValue({ slug: "a/6964802" });
  transport.values.mockResolvedValue({
    "6964802": {
      materialId: 6964802, recordId: "record",
      "含人物": false, "分类": ["leaf"],
      __metadata: { fields: [{ name: "分类", options: [{ id: "leaf", label: "口红" }] }] },
    },
  });
  expect(metadataDisplayValues(await fetchReviewMetadataValues(2865))).toEqual([
    { name: "含人物", value: false }, { name: "分类", value: ["口红"] },
  ]);
  expect(transport.asset).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2865, teamId: 1 } }));
});
