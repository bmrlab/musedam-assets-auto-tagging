import { promises as fs } from "fs";
import { join } from "path";
import { rootLogger } from "./logging";

/**
 * 清理临时文件和缓存文件，防止磁盘空间问题
 * 在容器环境中，应该避免创建文件，但如果必须创建，需要确保及时清理
 */
export async function cleanupTempFiles(): Promise<void> {
  const logger = rootLogger.child({ service: "file-cleanup" });
  
  try {
    // 清理 Next.js 缓存目录（如果存在）
    const nextCacheDir = join(process.cwd(), ".next", "cache");
    try {
      const stats = await fs.stat(nextCacheDir);
      if (stats.isDirectory()) {
        const files = await fs.readdir(nextCacheDir);
        let cleanedCount = 0;
        
        for (const file of files) {
          const filePath = join(nextCacheDir, file);
          try {
            const fileStats = await fs.stat(filePath);
            // 删除超过 7 天的缓存文件
            const ageInDays = (Date.now() - fileStats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            if (ageInDays > 7) {
              await fs.rm(filePath, { recursive: true, force: true });
              cleanedCount++;
            }
          } catch (error) {
            // 忽略单个文件删除错误，继续清理其他文件
            logger.warn({ file: file, error: String(error) }, "Failed to clean cache file");
          }
        }
        
        if (cleanedCount > 0) {
          logger.info({ cleanedCount, cacheDir: nextCacheDir }, "Cleaned old cache files");
        }
      }
    } catch (error) {
      // 缓存目录不存在是正常的，不需要记录错误
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.debug({ error: String(error) }, "Cache directory check failed");
      }
    }

    // 清理系统临时目录中的临时文件（如果应用创建了任何）
    const tempDirs = [
      "/tmp/musedam-auto-tagging",
      join(process.cwd(), "tmp"),
      join(process.cwd(), "temp"),
    ];

    for (const tempDir of tempDirs) {
      try {
        const stats = await fs.stat(tempDir);
        if (stats.isDirectory()) {
          const files = await fs.readdir(tempDir);
          let cleanedCount = 0;
          
          for (const file of files) {
            const filePath = join(tempDir, file);
            try {
              const fileStats = await fs.stat(filePath);
              // 删除超过 1 天的临时文件
              const ageInHours = (Date.now() - fileStats.mtime.getTime()) / (1000 * 60 * 60);
              if (ageInHours > 24) {
                await fs.rm(filePath, { recursive: true, force: true });
                cleanedCount++;
              }
            } catch (error) {
              logger.warn({ file: file, error: String(error) }, "Failed to clean temp file");
            }
          }
          
          if (cleanedCount > 0) {
            logger.info({ cleanedCount, tempDir }, "Cleaned old temp files");
          }
        }
      } catch (error) {
        // 临时目录不存在是正常的
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.debug({ tempDir, error: String(error) }, "Temp directory check failed");
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, "File cleanup failed");
  }
}

/**
 * 初始化文件清理机制
 * - 应用启动时执行一次清理
 * - 注册定期清理任务（每 6 小时）
 * - 注册进程退出时的清理
 */
export function initFileCleanup(): void {
  const logger = rootLogger.child({ service: "file-cleanup-init" });
  
  // 应用启动时立即清理一次
  cleanupTempFiles().catch((error) => {
    logger.error({ err: error }, "Initial file cleanup failed");
  });

  // 每 6 小时清理一次
  const cleanupInterval = setInterval(() => {
    cleanupTempFiles().catch((error) => {
      logger.error({ err: error }, "Scheduled file cleanup failed");
    });
  }, 6 * 60 * 60 * 1000); // 6 小时

  // 进程退出时清理
  // 注意：在 Kubernetes 环境中，SIGTERM 信号会由 Kubernetes 管理，不需要手动 exit
  const cleanupOnExit = async () => {
    clearInterval(cleanupInterval);
    try {
      // 异步清理，但不阻塞退出
      // 使用 Promise.race 确保不会无限等待
      await Promise.race([
        cleanupTempFiles(),
        new Promise((resolve) => setTimeout(resolve, 5000)), // 最多等待 5 秒
      ]);
      logger.info("File cleanup completed on exit");
    } catch (error) {
      logger.error({ err: error }, "File cleanup failed on exit");
      // 不调用 process.exit，让 Kubernetes 管理进程退出
    }
  };

  // 注册退出处理
  // SIGTERM: Kubernetes 发送的终止信号
  process.on("SIGTERM", cleanupOnExit);
  // SIGINT: Ctrl+C 或本地开发时的终止信号
  process.on("SIGINT", cleanupOnExit);
  
  // 正常退出时清理定时器
  process.on("exit", () => {
    clearInterval(cleanupInterval);
  });

  logger.info("File cleanup mechanism initialized");
}

