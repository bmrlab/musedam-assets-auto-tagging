import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetTag: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  KEYWORD_REJECTION_AUTO_EXCLUDE_THRESHOLD,
  recordKeywordRejectionFeedback,
} from "@/app/(tagging)/keyword-feedback";
import prisma from "@/prisma/prisma";

describe("recordKeywordRejectionFeedback", () => {
  beforeEach(() => {
    vi.mocked(prisma.assetTag.findUnique).mockReset();
    vi.mocked(prisma.assetTag.update).mockReset();
  });

  it("does nothing when the rejected asset gives no keyword signal for the tag", async () => {
    vi.mocked(prisma.assetTag.findUnique).mockResolvedValue({
      id: 3,
      teamId: 1,
      name: "POP-UP视频",
      extra: {},
    } as never);

    const result = await recordKeywordRejectionFeedback({
      teamId: 1,
      leafTagId: 3,
      materializedPath: "some/unrelated/banner.png",
      assetName: "unrelated banner",
    });

    expect(result).toEqual({});
    expect(prisma.assetTag.update).not.toHaveBeenCalled();
  });

  it("increments the rejection counter without auto-excluding before the threshold", async () => {
    vi.mocked(prisma.assetTag.findUnique).mockResolvedValue({
      id: 3,
      teamId: 1,
      name: "POP-UP视频",
      extra: { keywordRejectionCounts: { pop: 1 } },
    } as never);

    const result = await recordKeywordRejectionFeedback({
      teamId: 1,
      leafTagId: 3,
      materializedPath: "20260728_TM_SWS_POP_门面+tmall logo",
      assetName: "20260728_TM_SWS_POP_门面+tmall logo",
    });

    expect(result).toEqual({});
    expect(prisma.assetTag.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        extra: expect.objectContaining({
          keywordRejectionCounts: { pop: 2 },
          negativeKeywords: [],
        }),
      },
    });
  });

  it("auto-excludes the keyword once the rejection count reaches the threshold", async () => {
    vi.mocked(prisma.assetTag.findUnique).mockResolvedValue({
      id: 3,
      teamId: 1,
      name: "POP-UP视频",
      extra: { keywordRejectionCounts: { pop: KEYWORD_REJECTION_AUTO_EXCLUDE_THRESHOLD - 1 } },
    } as never);

    const result = await recordKeywordRejectionFeedback({
      teamId: 1,
      leafTagId: 3,
      materializedPath: "20260728_TM_SWS_POP_门面+tmall logo",
      assetName: "20260728_TM_SWS_POP_门面+tmall logo",
    });

    expect(result).toEqual({ autoExcludedKeyword: "pop" });
    expect(prisma.assetTag.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        extra: expect.objectContaining({
          keywordRejectionCounts: { pop: KEYWORD_REJECTION_AUTO_EXCLUDE_THRESHOLD },
          negativeKeywords: ["pop"],
        }),
      },
    });
  });

  it("is a no-op once the keyword is already excluded", async () => {
    vi.mocked(prisma.assetTag.findUnique).mockResolvedValue({
      id: 3,
      teamId: 1,
      name: "POP-UP视频",
      extra: { negativeKeywords: ["pop"] },
    } as never);

    const result = await recordKeywordRejectionFeedback({
      teamId: 1,
      leafTagId: 3,
      materializedPath: "20260728_TM_SWS_POP_门面+tmall logo",
      assetName: "20260728_TM_SWS_POP_门面+tmall logo",
    });

    expect(result).toEqual({});
    expect(prisma.assetTag.update).not.toHaveBeenCalled();
  });

  it("ignores a tag that does not belong to the acting team", async () => {
    vi.mocked(prisma.assetTag.findUnique).mockResolvedValue({
      id: 3,
      teamId: 99,
      name: "POP-UP视频",
      extra: {},
    } as never);

    const result = await recordKeywordRejectionFeedback({
      teamId: 1,
      leafTagId: 3,
      materializedPath: "20260728_TM_SWS_POP_门面+tmall logo",
      assetName: "20260728_TM_SWS_POP_门面+tmall logo",
    });

    expect(result).toEqual({});
    expect(prisma.assetTag.update).not.toHaveBeenCalled();
  });
});
