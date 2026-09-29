import { rootLogger } from "@/lib/logging";
import { spawn, type ChildProcess } from "node:child_process";
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

/** 子进程侧：主进程退出（ipc 断开）时自行退出，避免残留孤儿进程继续领取任务。 */
export function exitWhenParentExits() {
  if (!process.send) return;
  process.once("disconnect", () => {
    rootLogger.warn({ msg: "Queue worker parent process gone, exiting" });
    process.exit(0);
  });
}
