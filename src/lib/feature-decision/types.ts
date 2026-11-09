export type FeatureDecisionType = "product" | "logo" | "ip";
export type FeatureDecisionInputMode = "image" | "text";

/** Serializable gateway payload, suitable for JSON columns and server actions. */
export type FeatureJsonValue =
  | string
  | number
  | boolean
  | null
  | FeatureJsonValue[]
  | { [key: string]: FeatureJsonValue };

export type FeatureDecisionCandidate = {
  candidateId: string;
  featureType: FeatureDecisionType;
  classId: string;
  name: string;
  typeName: string;
  description?: string;
  /** Catalog notes, including user-maintained product nicknames. */
  notes?: string;
  referenceImage?: string;
  similarity: number;
  imageSimilarity?: number;
  descriptionSimilarity?: number;
  retrievedRegions?: number;
  regionIds?: string[];
  /** Retrieval observations for this candidate in each source region; not spatial OCR. */
  regionEvidence?: Array<{
    regionId: string;
    wholeAssetFallback?: boolean;
    similarity: number;
    imageSimilarity: number;
    descriptionSimilarity: number;
  }>;
  referenceMatchStrategy?: "highest" | "average";
  folderMatch?: { alias: string; path: string };
  ocrMatch?: { alias: string };
};

export type FeatureEvidence = "visual" | "retrieval" | "filename" | "path" | "ocr";

/** A model prediction, including uncertain alternatives; confidence is not a calibrated probability. */
export type FeatureDecisionMatch = {
  candidateId: string;
  confidence: number;
  reason: string;
  evidence: FeatureEvidence[];
  conflicts: string[];
  specificityLimit: string | null;
};

export type FeatureDecisionResponse = {
  outcome: "matched" | "no_match";
  matches: FeatureDecisionMatch[];
};

export type OcrResponse = { content: string[][] };

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type FeatureChatMessage = {
  role: "system" | "user";
  content: string | ChatContentPart[];
};

export type FeatureChatRequest = {
  model: string;
  messages: FeatureChatMessage[];
  max_tokens?: number;
  enable_thinking?: boolean;
  response_format?: { type: "json_object" };
};

export type OpenAIChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; image_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number; text_tokens?: number };
};

/** Only the standard envelope is parsed; provider-specific fields remain in rawResponse. */
export type OpenAIChatResponse = {
  id?: string;
  model?: string;
  choices: Array<{
    finish_reason?: string | null;
    message: { role?: string; content: string | null; refusal?: string | null };
  }>;
  usage?: OpenAIChatUsage;
};

export type FeatureLlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  imageTokens: number | null;
};

export type FeatureLlmCosts = {
  currency: "USD";
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  inputPricePerMillion: number | null;
  cachedInputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
};

export type FeatureLlmCallDiagnostics = {
  id?: string;
  kind: "ocr" | "decision";
  model: string;
  status: "completed" | "failed";
  durationMs: number;
  request: FeatureChatRequest;
  /** Assistant text as received, including any Markdown fences. */
  response: string | null;
  rawResponse: FeatureJsonValue;
  usage: FeatureLlmUsage;
  costs: FeatureLlmCosts;
  error?: string;
  persistenceError?: string;
};

export type FeatureOcrDiagnostics = {
  source?: "musedam" | "model";
  status: "completed" | "empty" | "failed" | "disabled" | "skipped";
  segments: string[];
  call?: FeatureLlmCallDiagnostics;
  error?: string;
};

export type FeatureDecisionDiagnostics = {
  /** Exact alias hits for logos with an explicit positive folder inclusion rule. */
  folderMatchedLogoIds?: string[];
  ocrMatchedLogoIds?: string[];
  decisionInputMode?: FeatureDecisionInputMode;
  reconciliation?: { suppressedIdentityTagIds: number[] };
  mode?: "llm" | "legacy";
  retrieval?: {
    regionsDetected: number;
    regionsSelected: number;
    regionsOmitted: number;
    regionsDeduplicated: number;
    candidatesRetrieved: number;
    unassessedCandidates: Array<{ candidateId: string; reason: string }>;
    errors: string[];
  };
  ocr: FeatureOcrDiagnostics;
  decision: {
    status: "completed" | "failed" | "skipped";
    batches?: Array<{
      candidateIds: string[];
      status: "completed" | "failed";
      call: FeatureLlmCallDiagnostics;
      error?: string;
    }>;
    result?: FeatureDecisionResponse;
    call?: FeatureLlmCallDiagnostics;
    error?: string;
  };
};

export type FeatureLlmContext = {
  teamId: number;
  queueItemId?: number;
  assetObjectId?: number;
};
