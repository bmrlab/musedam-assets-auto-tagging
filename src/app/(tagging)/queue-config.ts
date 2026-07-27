// The worker keeps one of its three slots reserved for tag-tree generation.
export const TOTAL_QUEUE_CONCURRENCY = 3;
export const TAG_TREE_RESERVED_CONCURRENCY = 1;
export const ASSET_TAGGING_CONCURRENCY = TOTAL_QUEUE_CONCURRENCY - TAG_TREE_RESERVED_CONCURRENCY;
export const PROCESSING_TIMING_VERSION = 2;
export const QUEUE_ITEM_HEADROOM_SECONDS = 20;
