// Node-only body of the embedded queue scheduler, split out of
// instrumentation.ts so it never reaches the Edge runtime compile. See the
// comment there for why the split matters.
export async function register() {
  if (process.env.EMBEDDED_QUEUE_SCHEDULER !== "true") return;

  // Guarded on `global` so dev-mode hot reload can't stack up duplicate intervals.
  const globalForScheduler = global as unknown as { __embeddedQueueSchedulerStarted?: boolean };
  if (globalForScheduler.__embeddedQueueSchedulerStarted) return;
  globalForScheduler.__embeddedQueueSchedulerStarted = true;

  const { rootLogger } = await import("@/lib/logging");
  const { processPendingQueueItems } = await import("@/app/(tagging)/queue");
  const { runScheduledTagging } = await import("@/app/(tagging)/scheduled-tagging");

  const logger = rootLogger.child({ service: "embedded-queue-scheduler" });
  const pollIntervalMs = Number(process.env.QUEUE_POLL_INTERVAL_MS ?? 30_000);

  logger.info({ msg: "Embedded queue scheduler starting", pollIntervalMs });

  let scheduledTaggingLastRun = new Date().toDateString();
  let isTickRunning = false;

  setInterval(() => {
    if (isTickRunning) return;
    isTickRunning = true;

    void (async () => {
      try {
        const result = await processPendingQueueItems();
        logger.info({ msg: "Embedded queue tick completed", ...result });

        const now = new Date();
        const today = now.toDateString();
        if (
          scheduledTaggingLastRun !== today &&
          now.getHours() === 0 &&
          now.getMinutes() < 10
        ) {
          scheduledTaggingLastRun = today;
          const summary = await runScheduledTagging();
          logger.info({ msg: "Embedded scheduled tagging completed", ...summary });
        }
      } catch (error) {
        logger.error({ msg: "Embedded queue tick failed", err: error });
      } finally {
        isTickRunning = false;
      }
    })();
  }, pollIntervalMs);
}
