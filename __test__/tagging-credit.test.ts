import { getTaggingCreditCost, getTaggingCreditQuote } from "@/lib/tagging-credit";
import { describe, expect, it } from "vitest";

describe("duration billing frames", () => {
  it.each([
    [1, 1],
    [1999, 1],
    [2000, 1],
    [2001, 2],
    [4000, 2],
    [4001, 3],
    [16000, 8],
    [16001, 8],
    [3600000, 8],
    [undefined, 1],
    [null, 1],
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [Infinity, 1],
  ])("prices duration %s ms as %s frames in both image modes", (duration, frames) => {
    for (const enabled of [false, true]) {
      expect(
        getTaggingCreditQuote(enabled, { extra: { extension: ".MP4", duration } }),
      ).toMatchObject({
        creditPricingVersion: "video-duration-v1",
        creditFrameCount: frames,
        creditCost: frames * (enabled ? 2 : 1),
      });
    }
  });
  it("keeps images at one frame even if metadata has a duration", () => {
    expect(getTaggingCreditCost(true, { extra: { extension: "gif", duration: 60000 } })).toBe(2);
    expect(getTaggingCreditCost(false)).toBe(1);
    expect(
      getTaggingCreditQuote(true, { name: "clip.mp4", extra: { duration: 9000 } }).creditCost,
    ).toBe(10);
  });
});
