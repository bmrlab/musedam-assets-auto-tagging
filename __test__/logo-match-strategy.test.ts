import { queryLogoVectorPoints } from "@/lib/brand/pgvector";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: { $queryRawUnsafe: mocks.query },
}));
vi.mock("@/lib/pgvector/client", () => ({
  deletePointsByFilter: vi.fn(),
  executeRawInsert: vi.fn(),
  executeRawUpdate: vi.fn(),
}));

describe("logo reference match strategies", () => {
  beforeEach(() => vi.resetAllMocks());

  it("ranks classes with average or maximum reference similarity before applying top-k", async () => {
    mocks.query.mockResolvedValue([
      {
        assetLogoId: "average-logo",
        referenceMatchStrategy: "average",
        similarity: 0.72,
        matchedReferenceImageId: "average-image",
      },
      {
        assetLogoId: "highest-logo",
        referenceMatchStrategy: "highest",
        similarity: 0.7,
        matchedReferenceImageId: "highest-image",
      },
    ]);

    const result = await queryLogoVectorPoints({
      teamId: 7,
      vector: [0.1, 0.2],
      limit: 3,
      scoreThreshold: 0.45,
    });

    expect(result).toEqual([
      expect.objectContaining({
        score: 0.72,
        payload: expect.objectContaining({
          assetLogoId: "average-logo",
          assetLogoImageId: "average-image",
          referenceMatchStrategy: "average",
        }),
      }),
      expect.objectContaining({
        score: 0.7,
        payload: expect.objectContaining({
          assetLogoId: "highest-logo",
          assetLogoImageId: "highest-image",
          referenceMatchStrategy: "highest",
        }),
      }),
    ]);
    const sql = String(mocks.query.mock.calls[0][0]);
    expect(sql).toContain('THEN AVG("pointSimilarity")');
    expect(sql).toContain('ELSE MAX("pointSimilarity")');
    expect(sql.indexOf('GROUP BY "assetLogoId"')).toBeLessThan(sql.indexOf("LIMIT $4"));
    expect(mocks.query).toHaveBeenCalledWith(sql, 7, "[0.1,0.2]", 0.45, 3);
  });
});
