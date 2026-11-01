import { APICallError, RetryError } from "ai";

/**
 * 模型服务本身不可用（欠费/鉴权失败/限流/5xx 等，网关返回了非 2xx）时抛的是 APICallError，
 * 可重试的状态码被 SDK 内部重试耗尽后会包成 RetryError。这类错误换个模型有机会成功；
 * 超时、模型输出不符合 schema 之类的错误不在此列，换模型没意义。
 */
export function isLLMApiCallError(error: unknown): boolean {
  if (APICallError.isInstance(error)) return true;
  if (RetryError.isInstance(error)) {
    return (
      APICallError.isInstance(error.lastError) ||
      error.errors.some((inner) => APICallError.isInstance(inner))
    );
  }
  return false;
}

/** 主模型 + 备用模型（逗号分隔），去重去空。fallbackEnv 设为空串即关闭兜底。 */
export function resolveModelChain<T extends string>(
  primary: T,
  fallbackEnv: string | undefined,
  defaultFallbacks: string,
): T[] {
  const fallbacks = (fallbackEnv ?? defaultFallbacks)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean) as T[];
  return [...new Set([primary, ...fallbacks])];
}

/**
 * 依次用 models 里的模型执行 run：只有模型服务调用失败（isLLMApiCallError）才切到下一个，
 * 其它错误原样抛出；最后一个模型也失败就抛它的错误。
 */
export async function runWithModelFallback<T, M extends string>(
  models: M[],
  run: (modelName: M) => Promise<T>,
  onFallback?: (info: { failedModel: M; nextModel: M; error: unknown }) => void,
): Promise<T> {
  for (let i = 0; ; i++) {
    const modelName = models[i];
    try {
      return await run(modelName);
    } catch (error) {
      const nextModel = models[i + 1];
      if (nextModel === undefined || !isLLMApiCallError(error)) throw error;
      onFallback?.({ failedModel: modelName, nextModel, error });
    }
  }
}
