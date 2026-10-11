// The worker keeps one of its slots reserved for tag-tree generation.
// 之前中国区降到 2（队列与 web 抢同一个事件循环，1 核时会把 pod 拖到探针超时）；现在中国区队列跑在
// 独立的 worker 子进程里（见 queue-role.ts），pod 为 2 核，外部调用有超时、子进程有内存看门狗，统一为 6。
// QUEUE_CONCURRENCY 可显式覆盖；至少为 2，保证素材打标和标签树各有一个槽位。
const DEFAULT_TOTAL_QUEUE_CONCURRENCY = 6;
export const TOTAL_QUEUE_CONCURRENCY = Math.max(
  2,
  Number(process.env.QUEUE_CONCURRENCY) || DEFAULT_TOTAL_QUEUE_CONCURRENCY,
);
export const TAG_TREE_RESERVED_CONCURRENCY = 1;
export const ASSET_TAGGING_CONCURRENCY = TOTAL_QUEUE_CONCURRENCY - TAG_TREE_RESERVED_CONCURRENCY;
export const PROCESSING_TIMING_VERSION = 2;
export const QUEUE_ITEM_HEADROOM_SECONDS = 20;
// 取消的排队任务复用 failed 状态，并用 result.error 区分，避免数据库 schema migration。
export const CANCELLED_TASK_ERROR_CODE = "CANCELLED";
