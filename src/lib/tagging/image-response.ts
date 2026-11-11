import "server-only";

/** Enforce the actual streamed size, even for missing/incorrect Content-Length.
 * Do not await cancellation: a proxied response can otherwise hang on cancel(). */
export async function readImageResponse(
  response: Response,
  maxBytes: number,
  tooLarge: (bytes: number) => Error,
): Promise<Buffer> {
  const cancel = () => {
    void response.body?.cancel().catch(() => {});
  };
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancel();
    throw tooLarge(declared);
  }
  if (!response.body) throw new Error("Image response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge(total);
      }
      chunks.push(value);
    }
    // Buffer.concat accepts Uint8Array; avoid copying every chunk first.
    return Buffer.concat(chunks, total);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
