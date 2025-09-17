import "server-only";

import { proxiedFetch } from "@/lib/proxy/fetch";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const bedrock = createAmazonBedrock({
  region: process.env.AWS_BEDROCK_REGION,
  accessKeyId: process.env.AWS_BEDROCK_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_BEDROCK_SECRET_ACCESS_KEY,
  fetch: proxiedFetch,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const azure = createAzure({
  resourceName: process.env.AZURE_RESOURCE_NAME,
  apiKey: process.env.AZURE_API_KEY,
  fetch: proxiedFetch,
});

const azureEastUS2 = createAzure({
  resourceName: process.env.AZURE_EASTUS2_RESOURCE_NAME,
  apiKey: process.env.AZURE_EASTUS2_API_KEY,
  fetch: proxiedFetch,
});

export const providerOptions = {
  openai: {
    stream_options: { include_usage: true },
  },
};

export type LLMModelName =
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "claude-3-7-sonnet"
  | "claude-sonnet-4";

export function llm(modelName: LLMModelName) {
  switch (modelName) {
    case "gpt-5":
    case "gpt-5-mini":
    case "gpt-5-nano":
      if (process.env.AZURE_EASTUS2_API_KEY) {
        break;
      } else {
        // 这里用了 completion, 下面 azure 的版本就也得用 completion
        // 否则 ai sdk 默认使用的 responses api 在 generateObject 上的逻辑和 completion api 不同
        // completion api 需要配置成 schema: z.array(z.object)
        // responses api 需要配置成 { schema: z.object, output: "array" }
        return openai.completion(modelName);
      }
    case "claude-3-7-sonnet":
    case "claude-sonnet-4":
      if (process.env.AWS_BEDROCK_ACCESS_KEY_ID) {
        break;
      } else {
        return openai(modelName);
      }
  }
  switch (modelName) {
    case "gpt-5":
      // return azureEastUS2("gpt-5");
      return azureEastUS2.completion("gpt-5");
    case "gpt-5-mini":
      // return azureEastUS2("gpt-5-mini");
      return azureEastUS2.completion("gpt-5-mini");
    case "gpt-5-nano":
      // return azureEastUS2("gpt-5-nano");
      return azureEastUS2.completion("gpt-5-nano");
    case "claude-3-7-sonnet":
      return bedrock("us.anthropic.claude-3-7-sonnet-20250219-v1:0");
    case "claude-sonnet-4":
      return bedrock("us.anthropic.claude-sonnet-4-20250514-v1:0");
  }
}
