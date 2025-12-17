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
  }: { method: "POST" | "GET"; body?: unknown; headers?: Record<string, string> },
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

  const response = await fetch(url, {
    method: method,
    body: requestBody,
    headers: requestHeaders,
  });
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
}
