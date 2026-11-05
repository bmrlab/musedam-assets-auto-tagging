import { classifyBrandImageCrops } from "@/lib/brand/logo-classification";
import { classifyIpImageCrops } from "@/lib/ip/ip-classification";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  logoQuery: vi.fn(),
  ipQuery: vi.fn(),
  logos: vi.fn(),
  ips: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand/jina", () => ({ createJinaImageEmbeddings: mocks.embed }));
vi.mock("@/lib/brand/pgvector", () => ({ queryLogoVectorPoints: mocks.logoQuery }));
vi.mock("@/lib/ip/pgvector", () => ({ queryIpVectorPoints: mocks.ipQuery }));
vi.mock("@/lib/media-process/object-detection", () => ({ detectMediaProcessObjects: vi.fn() }));
vi.mock("@/lib/translation/service", () => ({ translateDetectionLabelText: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetLogo: { findMany: mocks.logos },
    assetIp: { findMany: mocks.ips },
  },
}));

type Candidate = { id: string; score: number; sourceType?: "image" | "description" };
function setup(candidates: Candidate[][], unavailable: string[] = []) {
  mocks.embed.mockImplementation(async ({ images }: { images: string[] }) =>
    images.map((_, index) => [index]),
  );
  const ids = Array.from(new Set(candidates.flat().map((entry) => entry.id))).filter(
    (id) => !unavailable.includes(id),
  );
  mocks.logos.mockResolvedValue(
    ids.map((id) => ({
      id,
      name: id,
      logoTypeId: null,
      logoTypeName: "Logo",
    })),
  );
  mocks.ips.mockResolvedValue(
    ids.map((id) => ({
      id,
      name: id,
      ipTypeId: null,
      ipTypeName: "IP",
      description: "",
      tags: [],
    })),
  );
  mocks.logoQuery.mockImplementation(async ({ vector }: { vector: number[] }) =>
    candidates[vector[0]].map((entry, index) => ({
      id: `${entry.id}-${index}`,
      score: entry.score,
      payload: { assetLogoId: entry.id },
    })),
  );
  mocks.ipQuery.mockImplementation(
    async ({ vector, sourceType }: { vector: number[]; sourceType: "image" | "description" }) =>
      candidates[vector[0]]
        .filter((entry) => (entry.sourceType ?? "image") === sourceType)
        .map((entry, index) => ({
          id: `${entry.id}-${index}`,
          score: entry.score,
          payload: { assetIpId: entry.id, sourceType },
        })),
  );
}

function crops(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    image: `image-${index}`,
    box: {
      xMin: index * 10,
      yMin: 0,
      xMax: index * 10 + 10,
      yMax: 10,
      score: 0.9,
      label: "feature",
    },
  }));
}

describe.each([
  { name: "logo", classify: classifyBrandImageCrops, idKey: "assetLogoId" as const },
  { name: "IP", classify: classifyIpImageCrops, idKey: "assetIpId" as const },
])("$name regional candidate retrieval", ({ classify, idKey }) => {
  beforeEach(() => vi.resetAllMocks());

  it("unions regional top-three classes instead of limiting the entire asset to three", async () => {
    setup([
      [
        { id: "a", score: 0.95 },
        { id: "a", score: 0.94 },
        { id: "b", score: 0.93 },
        { id: "c", score: 0.92 },
        { id: "d", score: 0.91 },
      ],
      [
        { id: "a", score: 0.96 },
        { id: "e", score: 0.7 },
        { id: "f", score: 0.6 },
      ],
    ]);
    const result = await classify({ teamId: 7, crops: crops(2), retrievalOnly: true });
    expect(
      result.topMatches.map((match) => (match as unknown as Record<string, string>)[idKey]),
    ).toEqual(["a", "b", "c", "e", "f"]);
    expect(result.topMatches[0]).toMatchObject({ similarity: 0.96, detectionIndex: 1 });
    expect(result.noConfidentMatch).toBe(true);
  });

  it("filters unavailable classes before filling the three distinct regional slots", async () => {
    setup(
      [
        [
          { id: "gone", score: 0.99 },
          { id: "a", score: 0.8 },
          { id: "b", score: 0.7 },
          { id: "c", score: 0.6 },
        ],
      ],
      ["gone"],
    );
    const result = await classify({ teamId: 7, crops: crops(1), retrievalOnly: true });
    expect(
      result.topMatches.map((match) => (match as unknown as Record<string, string>)[idKey]),
    ).toEqual(["a", "b", "c"]);
  });

  it("retains the legacy three-candidate compatibility summary by default", async () => {
    setup([
      [
        { id: "a", score: 0.95 },
        { id: "b", score: 0.8 },
        { id: "c", score: 0.7 },
      ],
      [{ id: "d", score: 0.6 }],
    ]);
    const result = await classify({ teamId: 7, crops: crops(2) });
    expect(result.topMatches).toHaveLength(3);
    expect(result.noConfidentMatch).toBe(false);
  });

  it("rejects mismatched embedding counts", async () => {
    setup([[{ id: "a", score: 0.9 }]]);
    mocks.embed.mockResolvedValue([]);
    await expect(classify({ teamId: 7, crops: crops(1), retrievalOnly: true })).rejects.toThrow(
      "embedding count mismatch",
    );
  });
});

describe("IP retrieval evidence", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps the strongest fused regional score separate from legacy crop-support bonuses", async () => {
    setup(
      Array.from({ length: 3 }, () => [
        { id: "a", score: 0.6 },
        { id: "a", score: 0.5, sourceType: "description" as const },
      ]),
    );
    const result = await classifyIpImageCrops({ teamId: 7, crops: crops(3), retrievalOnly: true });
    expect(result.topMatches[0]).toMatchObject({
      similarity: 0.7,
      imageSimilarity: 0.6,
      descriptionSimilarity: 0.5,
      detectionIndex: 0,
    });
    const legacy = await classifyIpImageCrops({ teamId: 7, crops: crops(3) });
    expect(legacy.topMatches[0].similarity).toBeCloseTo(0.74);
  });
});
