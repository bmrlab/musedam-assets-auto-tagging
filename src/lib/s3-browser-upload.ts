const LOCAL_S3_OBJECT_PROXY_PATH = "/api/tagging/s3-object/";
const LOCAL_DEV_UPLOAD_CHUNK_BYTES = 512 * 1024;

type UploadS3ObjectFromBrowserOptions = {
  uploadUrl: string;
  file: Blob;
  contentType: string;
};

function isLocalS3ObjectProxyUrl(uploadUrl: string) {
  return uploadUrl.startsWith(LOCAL_S3_OBJECT_PROXY_PATH);
}

function createUploadId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function uploadS3ObjectFromBrowser({
  uploadUrl,
  file,
  contentType,
}: UploadS3ObjectFromBrowserOptions) {
  if (!isLocalS3ObjectProxyUrl(uploadUrl)) {
    return fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: file,
    });
  }

  const uploadId = createUploadId();
  const chunkCount = Math.max(Math.ceil(file.size / LOCAL_DEV_UPLOAD_CHUNK_BYTES), 1);
  let lastResponse: Response | null = null;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * LOCAL_DEV_UPLOAD_CHUNK_BYTES;
    const end = Math.min(start + LOCAL_DEV_UPLOAD_CHUNK_BYTES, file.size);
    const chunk = file.slice(start, end, contentType);

    lastResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "X-S3-Proxy-Upload-Id": uploadId,
        "X-S3-Proxy-Chunk-Index": String(chunkIndex),
        "X-S3-Proxy-Chunk-Count": String(chunkCount),
      },
      body: chunk,
    });

    if (!lastResponse.ok) {
      return lastResponse;
    }
  }

  return lastResponse ?? new Response(null, { status: 204 });
}
