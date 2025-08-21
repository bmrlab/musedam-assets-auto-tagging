import "server-only";

export async function requestMuseDAMAPI(
  apiPath: `/${string}`,
  {
    method,
    body,
    headers,
  }: { method: "POST" | "GET"; body?: unknown; headers?: Record<string, string> },
) {
  const response = await fetch(`https://muse-open.test.tezign.com${apiPath}`, {
    method: "POST",
    body: method === "POST" ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      "x-asm-prefer-tag": "version-env-06",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`MuseDAM API request failed, status code: ${response.status}`);
  }
  const result = await response.json();
  if (result["code"] + "" !== "0") {
    throw new Error(
      `MuseDAM API request failed, status code: ${response.status}, message: ${result["message"]}`,
    );
  }
  return result["result"] ?? result["data"] ?? {};
}
