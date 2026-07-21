import { createJinaImageEmbeddings } from "@/lib/brand/jina";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
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
    mocks.prepareImage.mockReset();
    mocks.prepareImage.mockImplementation(async (image: string) => `prepared:${image}`);
    mocks.fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input: Array<{ image: string }>;
      };

      return {
        ok: true,
        status: 200,
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
  });
});
