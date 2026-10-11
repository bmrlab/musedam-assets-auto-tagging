// 特征库参考图处理中途被中断（进程被杀）的标记，存在各特征表已有的 processingError 字段里，不需要 migration。
/** 中断过一次，等待重试。 */
export const FEATURE_PROCESSING_INTERRUPTED = "processing_interrupted";
/** 连续两次中断，放弃处理，避免反复拖垮进程。 */
export const FEATURE_PROCESSING_ABANDONED = "processing_abandoned";
