// 队列在哪个进程里跑。不引入任何重依赖，instrumentation 与 queue.ts 共用。
//
// 默认队列跑在 web 进程里。开启 worker 子进程模式后，web 主进程只处理页面和接口，
// 由它启动一个同镜像的子进程（同一个 server.js，只监听 127.0.0.1）专门跑打标队列和特征向量补算：
// 子进程再忙也不占主进程的事件循环，HTTP 探针照常响应；子进程崩溃只会被主进程拉起，
// 不会让 pod 重启、网站 503。

/** QUEUE_PAUSED=true：紧急开关，所有进程都不处理队列，任务留在 pending 不丢。 */
export const QUEUE_PAUSED_BY_ENV = process.env.QUEUE_PAUSED === "true";

/** 当前进程是主进程拉起的队列子进程。 */
export const IS_QUEUE_WORKER_CHILD = process.env.QUEUE_ROLE === "worker";

/**
 * 当前进程是否把队列交给子进程。QUEUE_WORKER_PROCESS=true/false 显式控制；未设置时中国区
 * （web 与队列抢 CPU、探针超时导致反复重启）默认开启。只在生产构建（有 server.js）里生效。
 */
export const USE_QUEUE_WORKER_PROCESS =
  !IS_QUEUE_WORKER_CHILD &&
  process.env.NODE_ENV === "production" &&
  (process.env.QUEUE_WORKER_PROCESS !== undefined
    ? process.env.QUEUE_WORKER_PROCESS === "true"
    : process.env.S3_REGION === "cn-north-1");
