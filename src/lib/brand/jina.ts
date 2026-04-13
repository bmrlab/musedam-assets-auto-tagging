import "server-only";

import { getJinaConfig } from "@/lib/brand/env";
import { ProxyAgent, fetch as nodeFetch } from "undici";

type JinaEmbeddingRecord = {
  embedding: number[];
  index: number;
};

type JinaResponse = {
  data?: JinaEmbeddingRecord[];
  detail?: string;
};

export async function createJinaImageEmbeddings({
  images,
  task,
}: {
  images: string[];
  task?: "retrieval.query";
}) {
  if (images.length === 0) {
    return [];
  }

  const config = getJinaConfig();
  const embeddings: number[][] = [];
  const proxyAgent = config.useProxy ? new ProxyAgent(config.proxyUrl) : undefined;

  for (let start = 0; start < images.length; start += config.batchSize) {
    const batch = images.slice(start, start + config.batchSize);
    const response = await nodeFetch(config.embeddingsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        ...(task ? { task } : {}),
        input: batch.map((image) => ({ image })),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
      dispatcher: proxyAgent,
    });

    const payload = (await response.json().catch(() => null)) as JinaResponse | null;
    if (!response.ok || !payload?.data) {
      const detail = payload?.detail ? `: ${payload.detail}` : "";
      throw new Error(`Jina embeddings request failed (${response.status})${detail}`);
    }

    const sorted = payload.data.slice().sort((left, right) => left.index - right.index);
    embeddings.push(...sorted.map((item) => item.embedding));
  }

  return embeddings;
}
