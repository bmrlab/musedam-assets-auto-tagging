import pino from "pino";

// 明确配置 pino 输出到 stdout，避免文件权限和磁盘空间问题
// 在容器环境中，日志应该输出到 stdout/stderr，由容器编排系统收集
// 观测云（DataKit）会自动收集容器的 stdout/stderr 日志
const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: null, // 不要 pid 和 hostname
  // 确保输出到 stdout，避免尝试创建文件
  // pino 默认输出 JSON 格式到 stdout，观测云可以自动解析
  transport: undefined, // 不使用 transport，直接输出到 stdout
  // 添加服务标识，方便在观测云中过滤和查询
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

// 捕获未处理的异常，避免进程崩溃
process.on("uncaughtException", (error) => {
  rootLogger.error(
    {
      err: error,
      type: "uncaughtException",
    },
    "Uncaught exception occurred",
  );
  // 不要立即退出，让应用有机会记录错误
  // 在生产环境中，应该由进程管理器（如 PM2、Kubernetes）来处理重启
});

process.on("unhandledRejection", (reason, promise) => {
  rootLogger.error(
    {
      err: reason,
      promise,
      type: "unhandledRejection",
    },
    "Unhandled rejection occurred",
  );
});

// 初始化文件清理机制（防止磁盘空间问题）
// 只在服务端环境中初始化，避免在客户端执行
if (typeof window === "undefined") {
  try {
    // 动态导入，避免在模块加载时立即执行
    import("./file-cleanup").then(({ initFileCleanup }) => {
      initFileCleanup();
    });
  } catch (error) {
    // 如果导入失败（例如在构建时），忽略错误
    rootLogger.debug({ err: error }, "File cleanup initialization skipped");
  }
}

export { rootLogger };
