import { assertQueueExecutionOwned, getQueueExecution, queueAbortSignal } from "@/lib/tagging/queue-execution";
import { getTagImportSignal } from "@/lib/tagging/tag-import-runtime";
import "server-only";
import { MUSE_TIMEOUT_MESSAGE } from "./budget";

const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api-key)$/i;

export { MUSE_CALL_BUDGET_MS, MUSE_TIMEOUT_MESSAGE, museCallBudget } from "./budget";

function sanitizeResponseText(value: string) {
  return value.replace(/(bearer\s+)[^\s"']+/gi, "$1[REDACTED]").slice(0, 1000);
}

export function generateCurlCommand(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): string {
  let curl = `curl -X ${method} '${url}'`;

  // 添加请求头
  Object.entries(headers).forEach(([key, value]) => {
    const safeValue = SENSITIVE_HEADER_PATTERN.test(key) ? "[REDACTED]" : value;
    curl += ` \\\n  -H '${key}: ${safeValue}'`;
  });

  // 添加请求体
  if (body) {
    curl += ` \\\n  -d '${body}'`;
  }

  return curl;
}

export async function requestMuseDAMAPI<T = unknown>(
  apiPath: `/${string}`,
  {
    method,
    body,
    headers,
    timeoutMs,
  }: {
    method: "POST" | "GET";
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<T> {
  if (getQueueExecution()) await assertQueueExecutionOwned();
  const url = `${process.env.MUSEDAM_API_BASE_URL}${apiPath}`;
  const requestHeaders = {
    "Content-Type": "application/json",
    // "x-asm-prefer-tag": "version-env-06",
    ...headers,
  };
  const requestBody = method === "POST" ? JSON.stringify(body) : undefined;

  // Keep enough request context for diagnostics without putting credentials or
  // customer payloads into container logs.
  const curlCommand = generateCurlCommand(url, method, requestHeaders);

  const importSignal = getTagImportSignal();
  importSignal?.throwIfAborted();
  // Import requests must not keep the team lease alive forever while awaiting an upstream.
  const requestTimeout = timeoutMs ?? (importSignal ? 75_000 : undefined);
  const timeoutSignal = requestTimeout ? AbortSignal.timeout(requestTimeout) : undefined;
  const requestSignal =
    importSignal && timeoutSignal
      ? AbortSignal.any([importSignal, timeoutSignal])
      : (importSignal ?? timeoutSignal);
  const signal = queueAbortSignal(requestSignal);
  let response: Response;
  try {
    response = await fetch(url, {
      method: method,
      body: requestBody,
      headers: requestHeaders,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) {
      const reason = signal.reason;
      // Import cancellation and queue abort carry their own message. A bare timeout does not.
      if (reason instanceof Error && reason.name !== "TimeoutError") throw reason;
      throw new Error(MUSE_TIMEOUT_MESSAGE);
    }
    throw error;
  }
  if (!response.ok) {
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }
    const safeResponseText = sanitizeResponseText(responseText);
    const errorMsg = `MuseDAM API request failed ${curlCommand}, status code: ${response.status}, response: ${safeResponseText || "<empty>"}`;
    throw new Error(errorMsg);
  }
  const result = await response.json();

  if (result["code"] + "" !== "0") {
    const errorMsg = `MuseDAM API request failed ${curlCommand}, status code: ${response.status}, message: ${result["message"]}`;
    throw new Error(errorMsg);
  }
  return (result["result"] ?? result["data"] ?? {}) as T;
}
