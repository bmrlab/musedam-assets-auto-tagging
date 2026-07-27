import { QUEUE_ITEM_HEADROOM_SECONDS } from "@/app/(tagging)/queue-config";

export const RECENT_PROCESSING_TIME_SAMPLE_SIZE = 20;

type CompletedTaskTiming = {
  startsAt: Date | null;
  endsAt: Date | null;
};

export function hasProcessingTimingVersion(extra: unknown, version: number): boolean {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return false;
  return (extra as { processingTimingVersion?: unknown }).processingTimingVersion === version;
}

export function calculateAverageProcessingTimeSeconds(tasks: CompletedTaskTiming[]): number {
  const durations = tasks.flatMap((task) => {
    if (!task.startsAt || !task.endsAt) return [];

    const processingDurationMs = task.endsAt.getTime() - task.startsAt.getTime();
    if (processingDurationMs < 0) return [];

    return [processingDurationMs + QUEUE_ITEM_HEADROOM_SECONDS * 1000];
  });

  if (durations.length === 0) return 0;

  const totalDurationMs = durations.reduce((sum, durationMs) => sum + durationMs, 0);
  return Math.round(totalDurationMs / durations.length / 1000);
}

export function calculateEstimatedRemainingTimeSeconds({
  averageProcessingTimeSeconds,
  pending,
  processing,
  concurrency,
}: {
  averageProcessingTimeSeconds: number;
  pending: number;
  processing: number;
  concurrency: number;
}): number {
  const remainingItems = Math.max(0, pending) + Math.max(0, processing);
  if (remainingItems === 0 || averageProcessingTimeSeconds <= 0 || concurrency <= 0) return 0;

  const remainingWorkSeconds = remainingItems * averageProcessingTimeSeconds;
  return Math.ceil(remainingWorkSeconds / concurrency);
}
