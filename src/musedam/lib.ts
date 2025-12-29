import "server-only";

export function generateCurlCommand(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): string {
  let curl = `curl -X ${method} '${url}'`;

  // 添加请求头
  Object.entries(headers).forEach(([key, value]) => {
    curl += ` \\\n  -H '${key}: ${value}'`;
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
    timeout = 30000, // 默认 30 秒超时
  }: {
    method: "POST" | "GET";
    body?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
  },
): Promise<T> {
  const url = `${process.env.MUSEDAM_API_BASE_URL}${apiPath}`;
  const requestHeaders = {
    "Content-Type": "application/json",
    // "x-asm-prefer-tag": "version-env-06",
    ...headers,
  };
  const requestBody = method === "POST" ? JSON.stringify(body) : undefined;

  // 打印curl命令
  const curlCommand = generateCurlCommand(url, method, requestHeaders, requestBody);
  // console.log("🔗 Curl Command:");
  // console.log(curlCommand);

  // 使用 AbortController 实现超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: method,
      body: requestBody,
      headers: requestHeaders,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // console.log("response", response)
    if (!response.ok) {
      const errorMsg = `MuseDAM API ${url} request failed, status code: ${response?.status}`;
      throw new Error(errorMsg);
    }
    const result = await response.json();

    if (result["code"] + "" !== "0") {
      const errorMsg = `MuseDAM API request failed ${curlCommand}, status code: ${response.status}, message: ${result["message"]}`;
      throw new Error(errorMsg);
    }
    return (result["result"] ?? result["data"] ?? {}) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`MuseDAM API ${url} request timeout after ${timeout}ms`);
    }
    throw error;
  }
}
