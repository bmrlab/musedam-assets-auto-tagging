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
  | "qwen3-vl-flash"
  | "claude-3-7-sonnet"
  | "claude-sonnet-4"
  | "claude-sonnet-4-6";

// Private deployments call back into our hosted model gateway (OPENAI_BASE_URL) instead of
// AWS Bedrock / Azure OpenAI directly — that's the intended fallback path below when
// AWS_BEDROCK_ACCESS_KEY_ID / AZURE_EASTUS2_API_KEY are left unset. Fail fast with a clear
// error here instead of letting ai-sdk surface an opaque auth error deep in the request.
function assertOpenAIGatewayConfigured(modelName: LLMModelName) {
  if (!process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY) {
    throw new Error(
      `Missing model gateway config for "${modelName}": set OPENAI_BASE_URL and OPENAI_API_KEY ` +
        `to point at the hosted model gateway (required whenever AWS_BEDROCK_ACCESS_KEY_ID / ` +
        `AZURE_EASTUS2_API_KEY are not configured, e.g. private deployments).`,
    );
  }
}

export function llm(modelName: LLMModelName) {
  switch (modelName) {
    case "gpt-5":
    case "gpt-5-mini":
    case "gpt-5-nano":
      if (process.env.AZURE_EASTUS2_API_KEY) {
        break;
      } else {
        assertOpenAIGatewayConfigured(modelName);
        return openai.chat(modelName);
      }
    case "claude-3-7-sonnet":
    case "claude-sonnet-4":
    case "claude-sonnet-4-6":
      if (process.env.AWS_BEDROCK_ACCESS_KEY_ID) {
        break;
      } else {
        assertOpenAIGatewayConfigured(modelName);
        return openai(modelName);
      }
    case "qwen3-vl-flash":
      assertOpenAIGatewayConfigured(modelName);
      return openai.chat(modelName);
  }
  switch (modelName) {
    case "gpt-5":
      return azureEastUS2.chat("gpt-5");
    case "gpt-5-mini":
      return azureEastUS2.chat("gpt-5-mini");
    case "gpt-5-nano":
      return azureEastUS2.chat("gpt-5-nano");
    case "claude-3-7-sonnet":
      return bedrock("us.anthropic.claude-3-7-sonnet-20250219-v1:0");
    case "claude-sonnet-4":
      return bedrock("us.anthropic.claude-sonnet-4-20250514-v1:0");
    case "claude-sonnet-4-6":
      return bedrock("us.anthropic.claude-sonnet-4-6");
  }
}
