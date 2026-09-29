// The worker keeps one of its slots reserved for tag-tree generation.
// 队列跑在 web 进程里。中国区 web 只有 1 核，6 并发在大批积压下会把 CPU 吃满、`/` 探针超时，
// pod 一直不就绪（503）并被反复重启；3 并发也扛不住，中国区降到 2（1 个素材打标 + 1 个标签树）。
// QUEUE_CONCURRENCY 可显式覆盖；至少为 2，保证素材打标和标签树各有一个槽位。
const DEFAULT_TOTAL_QUEUE_CONCURRENCY = process.env.S3_REGION === "cn-north-1" ? 2 : 6;
export const TOTAL_QUEUE_CONCURRENCY = Math.max(
  2,
  Number(process.env.QUEUE_CONCURRENCY) || DEFAULT_TOTAL_QUEUE_CONCURRENCY,
);
export const TAG_TREE_RESERVED_CONCURRENCY = 1;
export const ASSET_TAGGING_CONCURRENCY = TOTAL_QUEUE_CONCURRENCY - TAG_TREE_RESERVED_CONCURRENCY;
export const PROCESSING_TIMING_VERSION = 2;
export const QUEUE_ITEM_HEADROOM_SECONDS = 20;
