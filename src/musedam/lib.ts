import "server-only";

const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api-key)$/i;

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
  }: { method: "POST" | "GET"; body?: unknown; headers?: Record<string, string> },
): Promise<T> {
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

  const response = await fetch(url, {
    method: method,
    body: requestBody,
    headers: requestHeaders,
  });
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
