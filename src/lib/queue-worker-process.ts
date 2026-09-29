import { rootLogger } from "@/lib/logging";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { setPriority } from "node:os";

// 主进程拉起、守护队列子进程（模式说明见 src/app/(tagging)/queue-role.ts）。
// 子进程就是同一个 server.js，换一组环境变量启动：只监听 127.0.0.1、打开队列与内置调度器。

const WORKER_PORT = process.env.QUEUE_WORKER_PORT ?? "3101";
// 容器内存 limit 2Gi 由主进程与子进程共用：主进程只处理页面和接口，常驻几百 MB；
// 子进程要处理图片和打标结果，给它单独设堆上限，避免两者叠加超过 cgroup 限制被整体 OOM Kill。
const WORKER_MAX_OLD_SPACE_MB = process.env.QUEUE_WORKER_MAX_OLD_SPACE_MB ?? "768";
const WORKER_POLL_INTERVAL_MS = process.env.QUEUE_WORKER_POLL_INTERVAL_MS ?? "5000";
const RESTART_DELAY_MIN_MS = 5_000;
const RESTART_DELAY_MAX_MS = 60_000;
// 子进程稳定运行超过这个时长后再崩溃，重启等待时间从最小值重新计算
const STABLE_RUN_MS = 5 * 60_000;
// 两个进程共用容器的 CPU 配额：调低子进程的调度优先级，CPU 紧张时先保证主进程（页面、接口、探针）
const WORKER_NICE = 10;

export function startQueueWorkerProcess() {
  const logger = rootLogger.child({ service: "queue-worker-supervisor" });
  // standalone 下是 server.js；`next start` 下是 next CLI，同样可用
  const entry = process.argv[1];
  const execArgv = process.argv.slice(2);
  if (!entry) {
    logger.error({ msg: "Cannot start queue worker process: unknown entry script" });
    return;
  }

  let child: ChildProcess | null = null;
  let stopping = false;
  let restartDelayMs = RESTART_DELAY_MIN_MS;

  const start = () => {
    const startedAt = Date.now();
    child = spawn(process.execPath, [entry, ...execArgv], {
      env: {
        ...process.env,
        QUEUE_ROLE: "worker",
        PORT: WORKER_PORT,
        HOSTNAME: "127.0.0.1",
        EMBEDDED_QUEUE_SCHEDULER: "true",
        QUEUE_POLL_INTERVAL_MS: WORKER_POLL_INTERVAL_MS,
        NODE_OPTIONS: `--max-old-space-size=${WORKER_MAX_OLD_SPACE_MB}`,
        // glibc 默认按核数给每个线程开 malloc arena，libvips 多线程处理图片时原生内存会成倍膨胀
        MALLOC_ARENA_MAX: process.env.MALLOC_ARENA_MAX ?? "2",
      },
      // 日志直接写到容器 stdout/stderr；ipc 通道用于子进程感知主进程退出
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    if (child.pid) {
      try {
        setPriority(child.pid, WORKER_NICE);
      } catch (error) {
        logger.warn({ msg: "Failed to lower queue worker priority", err: error });
      }
    }
    logger.info({ msg: "Queue worker process started", pid: child.pid, port: WORKER_PORT });

    child.on("exit", (code, signal) => {
      child = null;
      if (stopping) return;
      if (Date.now() - startedAt > STABLE_RUN_MS) restartDelayMs = RESTART_DELAY_MIN_MS;
      logger.error({
        msg: "Queue worker process exited, restarting",
        code,
        signal,
        restartInMs: restartDelayMs,
      });
      setTimeout(start, restartDelayMs).unref();
      restartDelayMs = Math.min(restartDelayMs * 2, RESTART_DELAY_MAX_MS);
    });
    child.on("error", (error) => {
      logger.error({ msg: "Queue worker process error", err: error });
    });
  };

  // 主进程退出时一并结束子进程（exit 回调里只能做同步操作，kill 是同步发信号）
  process.once("exit", () => {
    stopping = true;
    child?.kill("SIGTERM");
  });

  start();
}

// 子进程常驻内存（RSS，含 sharp 等原生内存）的上限。容器 2Gi 的内存上限由主进程和子进程共用，
// 一旦整体超限，内核会把容器里所有进程一起 OOM Kill（页面也跟着 503）。子进程接近上限时主动退出，
// 由主进程拉起，把影响限制在队列里；正在处理的任务会被超时回收。
const WORKER_MAX_RSS_BYTES = Number(process.env.QUEUE_WORKER_MAX_RSS_MB ?? 1200) * 1024 * 1024;
const WORKER_RSS_CHECK_INTERVAL_MS = 500;

// 容器（cgroup）当前内存用量：包含主进程与子进程，最接近会触发 OOM Kill 的那个数
function readContainerMemoryBytes(): number | null {
  for (const file of [
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ]) {
    try {
      return Number(readFileSync(file, "utf8").trim());
    } catch {
      // 不在 cgroup 环境（本地开发）或路径不同，换下一个
    }
  }
  return null;
}

// 内存偏高时每 2 秒记一次，崩溃前的日志就能看到是怎么涨上去的（平时只有每分钟一次的内存日志）
const DETAILED_MEMORY_LOG_THRESHOLD_BYTES = 600 * 1024 * 1024;
const DETAILED_MEMORY_LOG_INTERVAL_MS = 2_000;

/** 子进程侧：内存接近上限时主动退出；内存偏高时记录细粒度内存日志。 */
export function exitWhenMemoryTooHigh() {
  const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024);
  let lastDetailedLogAt = 0;
  setInterval(() => {
    const rss = process.memoryUsage.rss();
    const containerBytes = readContainerMemoryBytes();
    const now = Date.now();
    if (
      (rss >= DETAILED_MEMORY_LOG_THRESHOLD_BYTES ||
        (containerBytes ?? 0) >= DETAILED_MEMORY_LOG_THRESHOLD_BYTES * 2) &&
      now - lastDetailedLogAt >= DETAILED_MEMORY_LOG_INTERVAL_MS
    ) {
      lastDetailedLogAt = now;
      rootLogger.warn({
        msg: "Queue worker memory high",
        rssMB: toMB(rss),
        heapUsedMB: toMB(process.memoryUsage().heapUsed),
        containerMB: containerBytes === null ? null : toMB(containerBytes),
      });
    }
    if (rss < WORKER_MAX_RSS_BYTES) return;
    rootLogger.error({
      msg: "Queue worker memory too high, exiting to protect the container",
      rssMB: toMB(rss),
      limitMB: toMB(WORKER_MAX_RSS_BYTES),
      containerMB: containerBytes === null ? null : toMB(containerBytes),
    });
    process.exit(1);
  }, WORKER_RSS_CHECK_INTERVAL_MS).unref();
}

/** 子进程侧：主进程退出（ipc 断开）时自行退出，避免残留孤儿进程继续领取任务。 */
export function exitWhenParentExits() {
  if (!process.send) return;
  process.once("disconnect", () => {
    rootLogger.warn({ msg: "Queue worker parent process gone, exiting" });
    process.exit(0);
  });
}
