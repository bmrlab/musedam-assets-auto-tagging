import "server-only";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requestMuseDAMAPI(
  apiPath: string,
  {
    method,
    body,
    headers,
  }: { method: "POST" | "GET"; body?: any; headers?: Record<string, string> },
) {
  const response = await fetch(`https://muse-open.test.tezign.com`, {
    method: "POST",
    body: method === "POST" ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MUSEDAM_API_KEY}`,
      "x-asm-prefer-tag": "version-env-04",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`MuseDAM API request failed, status code: ${response.status}`);
  }
  const result = await response.json();
  if (result["code"] !== "0") {
    throw new Error(
      `MuseDAM API request failed, status code: ${response.status}, message: ${result["message"]}`,
    );
  }
  return result["result"];
}
