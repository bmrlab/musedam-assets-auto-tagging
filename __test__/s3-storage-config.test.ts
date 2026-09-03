import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const BASE_ENV = {
  AWS_ACCESS_KEY_ID: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  S3_BUCKET: "test-bucket",
  S3_ENDPOINT_URL: "https://s3.us-east-1.amazonaws.com",
  S3_REGION: "us-east-1",
};

async function importS3Module() {
  vi.resetModules();
  return await import("@/lib/s3");
}

describe("s3 storage config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...BASE_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to path-style addressing for AWS S3 and compatible providers that allow it", async () => {
    const { getS3ObjectUrl } = await importS3Module();
    expect(getS3ObjectUrl("teams-1-asset-logos-abc.png")).toBe(
      "https://s3.us-east-1.amazonaws.com/test-bucket/teams-1-asset-logos-abc.png",
    );
  });

  it("switches to virtual-hosted-style addressing when S3_FORCE_PATH_STYLE=false", async () => {
    process.env.S3_FORCE_PATH_STYLE = "false";
    const { getS3ObjectUrl } = await importS3Module();
    expect(getS3ObjectUrl("teams-1-asset-logos-abc.png")).toBe(
      "https://test-bucket.s3.us-east-1.amazonaws.com/teams-1-asset-logos-abc.png",
    );
  });

  it("signs GET urls with SigV4 by default (regression check)", async () => {
    const { signS3ObjectUrl } = await importS3Module();
    const { signedUrl } = signS3ObjectUrl({ objectKey: "teams-1-asset-logos-abc.png" });
    const url = new URL(signedUrl);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("test-access-key");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("includes x-amz-acl on signed upload urls by default", async () => {
    const { signS3ObjectUploadUrl } = await importS3Module();
    const { signedUrl } = signS3ObjectUploadUrl({
      contentType: "image/png",
      objectKey: "teams-1-asset-logos-abc.png",
    });
    const url = new URL(signedUrl);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-acl");
  });

  it("omits x-amz-acl on signed upload urls when S3_SEND_ACL_HEADER=false", async () => {
    process.env.S3_SEND_ACL_HEADER = "false";
    const { signS3ObjectUploadUrl } = await importS3Module();
    const { signedUrl } = signS3ObjectUploadUrl({
      contentType: "image/png",
      objectKey: "teams-1-asset-logos-abc.png",
    });
    const url = new URL(signedUrl);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).not.toContain("x-amz-acl");
  });

  it("rejects invalid boolean values for the new toggles", async () => {
    process.env.S3_FORCE_PATH_STYLE = "maybe";
    const { getS3ObjectUrl } = await importS3Module();
    expect(() => getS3ObjectUrl("teams-1-asset-logos-abc.png")).toThrow(/Invalid boolean env/);
  });
});

// "特征库" (feature library, S3_FOLDER=feature-library): batch export/import and
// push-feature-to-musedam all hand out *unsigned* object URLs (getS3PublicObjectUrl) that must
// be anonymously readable — there is no signature to fall back on. These tests verify the
// actual upload request honors S3_SEND_ACL_HEADER, and that the "is this our own object" check
// still recognizes our URLs once path-style/ACL become configurable (both are load-bearing:
// wrong behavior here means exported/pushed image links silently 404 for everyone outside the
// storage account, since batch export/import and MuseDAM push all key off them).
describe("feature-library public object URLs", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, ...BASE_ENV, S3_FOLDER: "feature-library" };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("sends x-amz-acl: public-read on upload by default (AWS S3 behavior)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { uploadS3Object } = await importS3Module();
    await uploadS3Object({
      body: Buffer.from("fake-image-bytes"),
      contentType: "image/png",
      objectKey: "teams-1-asset-logos-abc.png",
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-amz-acl"]).toBe("public-read");
  });

  it("omits x-amz-acl on upload when S3_SEND_ACL_HEADER=false (provider needs bucket policy instead)", async () => {
    process.env.S3_SEND_ACL_HEADER = "false";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { uploadS3Object } = await importS3Module();
    await uploadS3Object({
      body: Buffer.from("fake-image-bytes"),
      contentType: "image/png",
      objectKey: "teams-1-asset-logos-abc.png",
    });

    const [, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-amz-acl"]).toBeUndefined();
  });

  it("recognizes its own public object URLs under path-style addressing", async () => {
    const { getS3PublicObjectUrl, isConfiguredS3PublicObjectUrl } = await importS3Module();
    const publicUrl = getS3PublicObjectUrl("feature-library/teams-1-asset-logos-abc.png");
    expect(publicUrl).toBe(
      "https://s3.us-east-1.amazonaws.com/test-bucket/feature-library/teams-1-asset-logos-abc.png",
    );
    expect(isConfiguredS3PublicObjectUrl(publicUrl)).toBe(true);
    expect(isConfiguredS3PublicObjectUrl("https://evil.example.com/feature-library/x.png")).toBe(
      false,
    );
  });

  it("recognizes its own public object URLs under virtual-hosted-style addressing (e.g. Aliyun OSS)", async () => {
    process.env.S3_FORCE_PATH_STYLE = "false";
    process.env.S3_ENDPOINT_URL = "https://s3.oss-cn-hangzhou.aliyuncs.com";
    const { getS3PublicObjectUrl, isConfiguredS3PublicObjectUrl } = await importS3Module();
    const publicUrl = getS3PublicObjectUrl("feature-library/teams-1-asset-logos-abc.png");
    expect(publicUrl).toBe(
      "https://test-bucket.s3.oss-cn-hangzhou.aliyuncs.com/feature-library/teams-1-asset-logos-abc.png",
    );
    expect(isConfiguredS3PublicObjectUrl(publicUrl)).toBe(true);
  });
});
