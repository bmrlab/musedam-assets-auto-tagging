// Node-only background workers, split out of instrumentation.ts so they never
// reach the Edge runtime compile. See the comment there for why the split matters.
export async function register() {
  const { rootLogger } = await import("@/lib/logging");

  // sharp（libvips）默认按宿主机核数开线程，而不是按容器的 CPU limit；在 1 核的 pod 里几个任务
  // 同时处理图片就会把 CFS 配额吃光，主线程也跟着被限流，连 `/` 探针都答不上。限制为单线程。
  try {
    const { default: sharp } = await import("sharp");
    sharp.concurrency(1);
  } catch (error) {
    rootLogger.warn({ msg: "Failed to limit sharp concurrency", err: error });
  }

  // 每分钟记一次内存水位：进程因堆溢出崩溃时来不及留日志，靠崩溃前的水位趋势定位问题。
  const globalForMemoryLog = global as unknown as { __memoryLogStarted?: boolean };
  if (!globalForMemoryLog.__memoryLogStarted) {
    globalForMemoryLog.__memoryLogStarted = true;
    const { getHeapStatistics } = await import("node:v8");
    const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024);
    const memoryLogger = rootLogger.child({
      service: "memory",
      role: process.env.QUEUE_ROLE === "worker" ? "queue-worker" : "web",
    });
    setInterval(() => {
      const { rss, heapUsed, external } = process.memoryUsage();
      memoryLogger.info({
        msg: "memory usage",
        rssMB: toMB(rss),
        heapUsedMB: toMB(heapUsed),
        heapLimitMB: toMB(getHeapStatistics().heap_size_limit),
        externalMB: toMB(external),
      });
    }, 60_000).unref();
  }
  const { IS_QUEUE_WORKER_CHILD, QUEUE_PAUSED_BY_ENV, USE_QUEUE_WORKER_PROCESS } = await import(
    "@/app/(tagging)/queue-role"
  );
  // 队列交给子进程时由主进程拉起并守护它（QUEUE_PAUSED=true 时整体暂停，不拉起）
  const globalForQueueWorker = global as unknown as { __queueWorkerStarted?: boolean };
  if (
    USE_QUEUE_WORKER_PROCESS &&
    !QUEUE_PAUSED_BY_ENV &&
    !globalForQueueWorker.__queueWorkerStarted
  ) {
    globalForQueueWorker.__queueWorkerStarted = true;
    const { startQueueWorkerProcess } = await import("@/lib/queue-worker-process");
    startQueueWorkerProcess();
  }
  if (IS_QUEUE_WORKER_CHILD) {
    const { exitWhenParentExits } = await import("@/lib/queue-worker-process");
    exitWhenParentExits();
  }

  const featureVectorLogger = rootLogger.child({ service: "feature-vector-worker" });

  const globalForFeatureVectors = global as unknown as {
    __featureVectorWorkerStarted?: boolean;
  };
  const { IS_QUEUE_PAUSED } = await import("@/app/(tagging)/queue");
  // 队列暂停时（QUEUE_PAUSED=true），特征向量补算同样不在 web 进程里跑
  if (!IS_QUEUE_PAUSED && !globalForFeatureVectors.__featureVectorWorkerStarted) {
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

      // 四个特征库依次跑、不并行：每个库都要下载参考图、sharp 处理、调 Jina，四个库同时跑在
      // 1 核的 web pod 里是一次很大的突发，积压时足以把进程拖到探针超时 / 崩溃。
      void (async () => [
        await runRecovery("Logo", processPendingAssetLogoReferenceVectors),
        await runRecovery("IP", processPendingAssetIpReferenceVectors),
        await runRecovery("Person", processPendingAssetPersonReferenceVectors),
        await runRecovery("Product", processPendingAssetProductReferenceVectors),
      ])()
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

    // 不在启动瞬间就跑：崩溃重启后上一轮卡在 processing 的特征会被整批捡回来重跑，
    // 和启动过程挤在一起容易让新 pod 还没就绪就又被拖垮。
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
        // 队列子进程只负责处理队列；每日定时打标仍由主进程侧（CronJob / 主进程内置调度器）触发，避免重复
        if (
          !IS_QUEUE_WORKER_CHILD &&
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
