// The worker keeps one of its three slots reserved for tag-tree generation.
export const TOTAL_QUEUE_CONCURRENCY = 6;
export const TAG_TREE_RESERVED_CONCURRENCY = 1;
export const ASSET_TAGGING_CONCURRENCY = TOTAL_QUEUE_CONCURRENCY - TAG_TREE_RESERVED_CONCURRENCY;
export const PROCESSING_TIMING_VERSION = 2;
export const QUEUE_ITEM_HEADROOM_SECONDS = 20;
// 用户在控制面板手动取消的排队任务：不新增状态（避免 migration），落为 failed + result.error = CANCELLED。
export const CANCELLED_TASK_ERROR_CODE = "CANCELLED";
