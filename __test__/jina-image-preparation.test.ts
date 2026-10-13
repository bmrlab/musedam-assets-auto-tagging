import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  debug: false,
  isDirectJina: false,
  prepareImage: vi.fn(),
  buildDebugKey: vi.fn(),
  upload: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand/env", () => ({
  isDebugPageEnabled: () => mocks.debug,
  getJinaConfig: () => ({
    apiKey: "test-key",
    embeddingsUrl: "https://example.test/embeddings",
    model: "jina-clip-v2",
    batchSize: 8,
    timeoutMs: 30_000,
    isDirectJina: mocks.isDirectJina,
    useProxy: false,
    proxyUrl: "",
  }),
}));
vi.mock("@/lib/s3", () => ({
  buildJinaDebugImageObjectKey: mocks.buildDebugKey,
  uploadS3Object: mocks.upload,
  signS3ObjectUrl: mocks.sign,
}));
vi.mock("@/lib/tagging/reference-image", () => ({
  prepareJinaImageDataUrl: mocks.prepareImage,
}));
vi.mock("undici", () => ({
  fetch: mocks.fetch,
  ProxyAgent: vi.fn(),
}));

describe("Jina image preparation boundary", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.debug = false;
    mocks.isDirectJina = false;
    mocks.prepareImage.mockReset();
    mocks.buildDebugKey.mockReset().mockReturnValue("debug-jina-image.jpg");
    mocks.upload.mockReset().mockResolvedValue({ objectKey: "debug-jina-image.jpg" });
    mocks.sign.mockReset().mockImplementation(({ objectKey }: { objectKey: string }) => ({
      signedUrl: `https://s3.test/${objectKey}`,
    }));
    mocks.prepareImage.mockImplementation(async (image: string) => `prepared:${image}`);
    mocks.fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input: Array<{ image: string }>;
      };

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          data: body.input.map((_item, index) => ({ index, embedding: [index] })),
        }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes every image before sending batches capped at four", async () => {
    const images = ["one", "two", "three", "four", "five"];

    await createJinaImageEmbeddings({ images });

    expect(prepareJinaImageDataUrl).toHaveBeenCalledTimes(images.length);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(mocks.fetch.mock.calls[1][1]?.body));
    expect(firstBody.input).toEqual(
      images.slice(0, 4).map((image) => ({ image: `prepared:${image}` })),
    );
    expect(secondBody.input).toEqual([{ image: "prepared:five" }]);
    expect(mocks.prepareImage).toHaveBeenCalledWith("one", { padToSquare: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("uploads and logs the exact prepared image when DEBUG_PAGE is enabled", async () => {
    mocks.debug = true;
    const prepared = `data:image/png;base64,${Buffer.from("prepared pixels").toString("base64")}`;
    mocks.prepareImage.mockResolvedValue(prepared);
    mocks.buildDebugKey.mockReturnValue("debug-jina-image.png");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await createJinaImageEmbeddings({ images: ["original"], padToSquare: true });

    expect(mocks.buildDebugKey).toHaveBeenCalledExactlyOnceWith(".png");
    expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({
      body: Buffer.from("prepared pixels"),
      contentType: "image/png",
      objectKey: "debug-jina-image.png",
    });
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith({
      objectKey: "debug-jina-image.png",
      expiresInSeconds: 7 * 24 * 60 * 60,
    });
    expect(log).toHaveBeenCalledWith(
      "[Jina image debug] image 1: https://s3.test/debug-jina-image.png",
    );
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    expect(body.input).toEqual([{ image: prepared }]);
  });

  it("still sends the prepared image if its optional debug upload fails", async () => {
    mocks.debug = true;
    const prepared = `data:image/jpeg;base64,${Buffer.from("jpeg bytes").toString("base64")}`;
    mocks.prepareImage.mockResolvedValue(prepared);
    mocks.upload.mockRejectedValueOnce(new Error("S3 unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await createJinaImageEmbeddings({ images: ["original"] });

    expect(warning).toHaveBeenCalledWith(
      "[Jina image debug] Failed to upload image 1 to S3",
      expect.any(Error),
    );
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    expect(body.input).toEqual([{ image: prepared }]);
  });

  it("pads query images when requested without adding a second embedding pass", async () => {
    await createJinaImageEmbeddings({
      images: ["tall", "wide"],
      task: "retrieval.query",
      padToSquare: true,
    });

    expect(mocks.prepareImage).toHaveBeenCalledWith("tall", { padToSquare: true });
    expect(mocks.prepareImage).toHaveBeenCalledWith("wide", { padToSquare: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(mocks.fetch.mock.calls[0][1]?.body));
    expect(body.task).toBe("retrieval.query");
    expect(body.input).toEqual([{ image: "prepared:tall" }, { image: "prepared:wide" }]);
  });

  it("caps concurrent Jina requests across embedding jobs", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;

    mocks.fetch.mockImplementation(async () => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests -= 1;

      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
      };
    });

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createJinaImageEmbeddings({ images: [`image-${index}`] }),
      ),
    );

    expect(maximumActiveRequests).toBe(8);
  });

  it("paces direct Jina requests according to their input token budget", async () => {
    mocks.isDirectJina = true;
    const requestStartedAt: number[] = [];
    mocks.fetch.mockImplementation(async () => {
      requestStartedAt.push(Date.now());
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
      };
    });

    await Promise.all([
      createJinaImageEmbeddings({ images: ["one"] }),
      createJinaImageEmbeddings({ images: ["two"] }),
    ]);

    expect(requestStartedAt[1] - requestStartedAt[0]).toBeGreaterThanOrEqual(300);
  });
});
