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

  it("defaults to path-style addressing (AWS S3 / OSS / TOS compatible)", async () => {
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
