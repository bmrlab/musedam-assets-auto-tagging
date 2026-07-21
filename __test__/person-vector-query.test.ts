import { queryPersonVectorCandidates } from "@/lib/person/pgvector";
import prisma from "@/prisma/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
  },
}));

describe("person vector candidate query", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRawUnsafe).mockReset();
  });

  it("groups reference vectors by identity before applying the candidate limit", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        assetPersonId: "person-a",
        rawSimilarity: 0.71,
        supportingReferenceCount: 3,
      },
      {
        assetPersonId: "person-b",
        rawSimilarity: 0.6,
        supportingReferenceCount: 1,
      },
    ]);

    const result = await queryPersonVectorCandidates({
      teamId: 7,
      vector: [0.1, 0.2, 0.3],
      limit: 24,
      candidateScoreFloor: 0.25,
      supportingScoreThreshold: 0.36,
    });

    const [query, ...params] = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    expect(query).toContain('GROUP BY "assetPersonId"');
    expect(query).toContain('ORDER BY "rawSimilarity" DESC');
    expect(query).toContain("LIMIT $4");
    expect(params).toEqual([7, 0.25, 0.36, 24]);
    expect(result).toEqual([
      {
        assetPersonId: "person-a",
        rawSimilarity: 0.71,
        supportingReferenceCount: 3,
      },
      {
        assetPersonId: "person-b",
        rawSimilarity: 0.6,
        supportingReferenceCount: 1,
      },
    ]);
  });

  it("rejects malformed embeddings before interpolating them into SQL", async () => {
    await expect(
      queryPersonVectorCandidates({
        teamId: 7,
        vector: [0.1, Number.NaN],
        limit: 24,
        candidateScoreFloor: 0.25,
        supportingScoreThreshold: 0.36,
      }),
    ).rejects.toThrow("finite numeric values");
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
