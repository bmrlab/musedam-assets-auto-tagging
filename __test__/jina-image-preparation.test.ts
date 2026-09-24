import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  isDirectJina: false,
  prepareImage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand/env", () => ({
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
    mocks.isDirectJina = false;
    mocks.prepareImage.mockReset();
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
    expect(body.input).toEqual([
      { image: "prepared:tall" },
      { image: "prepared:wide" },
    ]);
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
