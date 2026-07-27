import {
  calculateAverageProcessingTimeSeconds,
  calculateEstimatedRemainingTimeSeconds,
  hasProcessingTimingVersion,
  RECENT_PROCESSING_TIME_SAMPLE_SIZE,
} from "@/app/(tagging)/tagging/dashboard/queue-timing";
import { describe, expect, it } from "vitest";

describe("dashboard queue timing", () => {
  it("uses a 20-item recent history window", () => {
    expect(RECENT_PROCESSING_TIME_SAMPLE_SIZE).toBe(20);
  });

  it("distinguishes corrected timing samples from legacy queue timestamps", () => {
    expect(hasProcessingTimingVersion({ processingTimingVersion: 2 }, 2)).toBe(true);
    expect(hasProcessingTimingVersion({}, 2)).toBe(false);
    expect(hasProcessingTimingVersion(null, 2)).toBe(false);
  });

  it("adds 20 seconds of service headroom to every completed-item duration", () => {
    expect(
      calculateAverageProcessingTimeSeconds([
        { startsAt: new Date(1_000), endsAt: new Date(11_000) },
        { startsAt: new Date(5_000), endsAt: new Date(25_000) },
        { startsAt: null, endsAt: new Date(30_000) },
        { startsAt: new Date(40_000), endsAt: new Date(30_000) },
      ]),
    ).toBe(35);
  });

  it("converts remaining serial work into wall time using worker concurrency", () => {
    expect(
      calculateEstimatedRemainingTimeSeconds({
        averageProcessingTimeSeconds: 30,
        pending: 18,
        processing: 2,
        concurrency: 2,
      }),
    ).toBe(300);
  });

  it("returns zero when there is no remaining work or no timing history", () => {
    expect(
      calculateEstimatedRemainingTimeSeconds({
        averageProcessingTimeSeconds: 30,
        pending: 0,
        processing: 0,
        concurrency: 2,
      }),
    ).toBe(0);
    expect(
      calculateEstimatedRemainingTimeSeconds({
        averageProcessingTimeSeconds: 0,
        pending: 10,
        processing: 2,
        concurrency: 2,
      }),
    ).toBe(0);
  });
});
