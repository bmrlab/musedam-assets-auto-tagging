// 打标流程里外部调用的超时。之前这些请求都没有超时：任何一个挂住，任务就一直停在 processing，
// 而中国区只有 1 个素材打标槽位，整条队列会跟着停住，直到 15 分钟后被当作超时回收。
const ms = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/** 下载素材图片 / 参考图 */
export const IMAGE_FETCH_TIMEOUT_MS = ms("TAGGING_IMAGE_FETCH_TIMEOUT_MS", 60_000);
/** 目标检测、人脸检测 / 特征服务 */
export const DETECTION_TIMEOUT_MS = ms("TAGGING_DETECTION_TIMEOUT_MS", 120_000);
/** 大模型打标 / 分类调用（单次，重试另计） */
export const LLM_TIMEOUT_MS = ms("TAGGING_LLM_TIMEOUT_MS", 180_000);
