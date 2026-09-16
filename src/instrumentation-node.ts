// Node-only background workers, split out of instrumentation.ts so they never
// reach the Edge runtime compile. See the comment there for why the split matters.
export async function register() {
  const { rootLogger } = await import("@/lib/logging");
  const featureVectorLogger = rootLogger.child({ service: "feature-vector-worker" });

  const globalForFeatureVectors = global as unknown as {
    __featureVectorWorkerStarted?: boolean;
  };
  if (!globalForFeatureVectors.__featureVectorWorkerStarted) {
    globalForFeatureVectors.__featureVectorWorkerStarted = true;

    const { processPendingAssetLogoReferenceVectors } = await import("@/lib/brand/logo-processing");
    const { processPendingAssetIpReferenceVectors } = await import("@/lib/ip/ip-processing");
    const { processPendingAssetPersonReferenceVectors } = await import(
      "@/lib/person/person-processing"
    );
    const { processPendingAssetProductReferenceVectors } = await import(
      "@/lib/product/product-processing"
    );
    const featureVectorPollIntervalMs = 30_000;
    let isFeatureVectorTickRunning = false;
    const runRecovery = async (
      library: string,
      recovery: () => Promise<{ processing: number; recovered: number; skipped: number }>,
    ) => {
      try {
        return await recovery();
      } catch (error) {
        featureVectorLogger.error({
          msg: `${library} vector recovery failed`,
          err: error,
        });
        return { processing: 0, recovered: 0, skipped: 0 };
      }
    };

    const runFeatureVectorTick = () => {
      if (isFeatureVectorTickRunning) return;
      isFeatureVectorTickRunning = true;

      void Promise.all([
        runRecovery("Logo", processPendingAssetLogoReferenceVectors),
        runRecovery("IP", processPendingAssetIpReferenceVectors),
        runRecovery("Person", processPendingAssetPersonReferenceVectors),
        runRecovery("Product", processPendingAssetProductReferenceVectors),
      ])
        .then(([logos, ips, persons, products]) => {
          const hasWork = [logos, ips, persons, products].some(
            (result) => result.processing > 0 || result.recovered > 0,
          );
          if (hasWork) {
            featureVectorLogger.info({
              msg: "Feature vector recovery tick completed",
              logos,
              ips,
              persons,
              products,
            });
          }
        })
        .finally(() => {
          isFeatureVectorTickRunning = false;
        });
    };

    runFeatureVectorTick();
    setInterval(runFeatureVectorTick, featureVectorPollIntervalMs);
  }

  if (process.env.EMBEDDED_QUEUE_SCHEDULER !== "true") return;

  // Guarded on `global` so dev-mode hot reload can't stack up duplicate intervals.
  const globalForScheduler = global as unknown as { __embeddedQueueSchedulerStarted?: boolean };
  if (globalForScheduler.__embeddedQueueSchedulerStarted) return;
  globalForScheduler.__embeddedQueueSchedulerStarted = true;

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
        if (scheduledTaggingLastRun !== today && now.getHours() === 0 && now.getMinutes() < 10) {
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
