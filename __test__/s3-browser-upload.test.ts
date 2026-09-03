import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadS3ObjectFromBrowser } from "@/lib/s3-browser-upload";

describe("browser S3-compatible uploads", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends public-read when x-amz-acl is included in the signed headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadS3ObjectFromBrowser({
      uploadUrl:
        "https://bucket.s3.oss-cn-hangzhou.aliyuncs.com/a.png?X-Amz-SignedHeaders=content-type%3Bhost%3Bx-amz-acl",
      file: new Blob(["image"]),
      contentType: "image/png",
    });

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "Content-Type": "image/png",
      "x-amz-acl": "public-read",
    });
  });

  it("omits public-read when the server did not sign the ACL header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await uploadS3ObjectFromBrowser({
      uploadUrl:
        "https://bucket.s3.oss-cn-hangzhou.aliyuncs.com/a.png?X-Amz-SignedHeaders=content-type%3Bhost",
      file: new Blob(["image"]),
      contentType: "image/png",
    });

    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      "Content-Type": "image/png",
    });
  });
});
