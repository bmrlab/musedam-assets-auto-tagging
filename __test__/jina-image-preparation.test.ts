import { createJinaImageEmbeddings, createJinaTextEmbeddings } from "@/lib/brand/jina";
import { prepareJinaImageDataUrl } from "@/lib/tagging/reference-image";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    accessKeyId: "test-access-key",
    apiKey: "test-key",
    batchSize: 8,
    embeddingsUrl: "https://example.test/embeddings",
    endpointName: "test-jina-endpoint",
    isGlobal: true,
    model: "jina-clip-v2",
    proxyUrl: "",
    region: "ap-northeast-1",
    secretAccessKey: "test-secret-key",
    sessionToken: undefined as string | undefined,
    timeoutMs: 30_000,
    useProxy: false,
  },
  fetch: vi.fn(),
  prepareImage: vi.fn(),
  sageMakerClient: vi.fn(),
  sageMakerCommand: vi.fn(),
  sageMakerDestroy: vi.fn(),
  sageMakerSend: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand/env", () => ({
  getJinaConfig: () => mocks.config,
}));
vi.mock("@/lib/tagging/reference-image", () => ({
  prepareJinaImageDataUrl: mocks.prepareImage,
}));
vi.mock("@aws-sdk/client-sagemaker-runtime", () => ({
  InvokeEndpointCommand: class {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
      mocks.sageMakerCommand(input);
    }
  },
  SageMakerRuntimeClient: class {
    constructor(options: unknown) {
      mocks.sageMakerClient(options);
    }

    destroy() {
      mocks.sageMakerDestroy();
    }

    send(command: unknown, options: unknown) {
      return mocks.sageMakerSend(command, options);
    }
  },
}));
vi.mock("undici", () => ({
  fetch: mocks.fetch,
  ProxyAgent: vi.fn(),
}));

describe("Jina image preparation boundary", () => {
  beforeEach(() => {
    mocks.config.isGlobal = true;
    mocks.fetch.mockReset();
    mocks.prepareImage.mockReset();
    mocks.sageMakerClient.mockReset();
    mocks.sageMakerCommand.mockReset();
    mocks.sageMakerDestroy.mockReset();
    mocks.sageMakerSend.mockReset();
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

  it("uses the SageMaker payload for mainland image and text embeddings", async () => {
    mocks.config.isGlobal = false;
    mocks.prepareImage.mockImplementation(
      async (image: string) => `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`,
    );
    mocks.sageMakerSend
      .mockResolvedValueOnce({
        Body: new TextEncoder().encode(
          JSON.stringify({
            data: [
              { index: 1, embedding: [2] },
              { index: 0, embedding: [1] },
            ],
          }),
        ),
      })
      .mockResolvedValueOnce({
        Body: new TextEncoder().encode(JSON.stringify({ data: [{ index: 0, embedding: [3] }] })),
      });

    const imageEmbeddings = await createJinaImageEmbeddings({ images: ["one", "two"] });
    const textEmbeddings = await createJinaTextEmbeddings({
      texts: ["query"],
      task: "retrieval.query",
    });

    expect(imageEmbeddings).toEqual([[1], [2]]);
    expect(textEmbeddings).toEqual([[3]]);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.sageMakerClient).toHaveBeenCalledWith({
      credentials: {
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      },
      maxAttempts: 5,
      region: "ap-northeast-1",
    });

    const imageRequest = mocks.sageMakerCommand.mock.calls[0][0] as {
      Body: string;
      EndpointName: string;
    };
    const textRequest = mocks.sageMakerCommand.mock.calls[1][0] as {
      Body: string;
      EndpointName: string;
    };
    expect(imageRequest.EndpointName).toBe("test-jina-endpoint");
    expect(JSON.parse(imageRequest.Body)).toEqual({
      data: [
        { bytes: Buffer.from("one").toString("base64") },
        { bytes: Buffer.from("two").toString("base64") },
      ],
      parameters: {
        dimensions: "1024",
        task: "retrieval.passage",
      },
    });
    expect(JSON.parse(textRequest.Body)).toEqual({
      data: [{ text: "query" }],
      parameters: {
        dimensions: "1024",
        task: "retrieval.query",
      },
    });
    expect(mocks.sageMakerDestroy).toHaveBeenCalledTimes(2);
  });
});
