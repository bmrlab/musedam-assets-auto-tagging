import pino from "pino";

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: null, // 不要 pid 和 hostname
});

export { rootLogger };
