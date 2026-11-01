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

// Known names are for the SaaS/cloud path (Bedrock/Azure need a real vendor model id — see the
// cloud branch of llm() below). Anything else is treated as an opaque gateway-native model id
// and sent through as-is — e.g. a private deployment sets TAGGING_PREDICT_MODEL directly to a
// CR alias (CR's own model code, not a vendor name) with no extra mapping layer in this file.
type KnownLLMModelName =
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "claude-3-7-sonnet"
  | "claude-sonnet-4"
  | "claude-sonnet-4-6";
export type LLMModelName = KnownLLMModelName | (string & {});

const OPENAI_CLOUD_MODELS = new Set<string>(["gpt-5", "gpt-5-mini", "gpt-5-nano"]);
const BEDROCK_MODEL_ID: Record<string, string> = {
  "claude-3-7-sonnet": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
  "claude-sonnet-4": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
};

// LLM_PROVIDER is optional. Set it to pin the backend explicitly ("cloud" = Bedrock/Azure,
// "gateway" = OPENAI_BASE_URL-compatible gateway). Left unset, behavior is unchanged from
// before this was added: per model family, cloud is used if its cloud key is present,
// otherwise gateway — so existing deployments that only ever set OPENAI_BASE_URL/OPENAI_API_KEY
// keep working with no new required env vars.
export type LLMProvider = "cloud" | "gateway";

export function getLLMProviderOverride(): LLMProvider | undefined {
  const value = process.env.LLM_PROVIDER?.trim();
  if (!value) return undefined;
  if (value === "cloud" || value === "gateway") return value;
  throw new Error(`Invalid LLM_PROVIDER "${value}": expected "cloud" or "gateway".`);
}

function assertOpenAIGatewayConfigured(modelName: LLMModelName) {
  if (!process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY) {
    throw new Error(
      `Missing model gateway config for "${modelName}": set OPENAI_BASE_URL and OPENAI_API_KEY ` +
        `to point at the hosted model gateway.`,
    );
  }
}

export function llm(modelName: LLMModelName) {
  const override = getLLMProviderOverride();
  const isKnownClaude = modelName in BEDROCK_MODEL_ID;

  if (OPENAI_CLOUD_MODELS.has(modelName)) {
    const useCloud = override ? override === "cloud" : Boolean(process.env.AZURE_EASTUS2_API_KEY);
    if (useCloud) return azureEastUS2.chat(modelName);
  } else if (isKnownClaude) {
    const useCloud = override ? override === "cloud" : Boolean(process.env.AWS_BEDROCK_ACCESS_KEY_ID);
    if (useCloud) return bedrock(BEDROCK_MODEL_ID[modelName]);
  } else if (override === "cloud") {
    throw new Error(
      `"${modelName}" has no LLM_PROVIDER=cloud mapping — set LLM_PROVIDER=gateway (or unset it) ` +
        `to use it.`,
    );
  }

  // Gateway: send modelName straight through, unmodified — either one of the known names above
  // (if the gateway happens to register models under these) or an opaque gateway-native model
  // id, e.g. a CR alias, for private deployments that must not reveal the underlying vendor.
  assertOpenAIGatewayConfigured(modelName);
  return isKnownClaude ? openai(modelName) : openai.chat(modelName);
}
