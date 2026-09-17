declare module "@/prisma/client" {
  export * from "@/prisma/client/index";
  import { AssetTag } from "@/prisma/client/index";

  export type TagWithChildren = Pick<AssetTag, "id" | "name" | "extra"> & {
    children?: TagWithChildren[];
  };

  export type AssetObjectContentAnalysis = {
    aiTags?: string;
    aiTitle?: string;
    aiDescription?: string;
    aiDetailedDescription?: Record<string, string>[];
  };

  // typeof assetObject.tags
  export type AssetObjectTags = Array<{
    tagId?: number;
    tagSlug: string;
    tagPath: string[];
  }>;

  export type AssetObjectExtra = Partial<{
    thumbnailAccessUrl: string;
    downloadUrl: string;
    size: number;
    extension: string;
  }>;

  export type AssetTagExtra = Partial<{
    description: string;
    keywords: string[];
    negativeKeywords: string[];
    /** 审核拒绝反馈：命中该标签自动关键词、但被人工拒绝的累计次数，达到阈值后关键词会被自动写入 negativeKeywords */
    keywordRejectionCounts: Record<string, number>;
    /**
     * 证据策略：content = 描述画面内容本身，任何来源都可贡献；
     * literal = 描述素材之外的业务安排（渠道/市场/活动/档期），必须有字面证据。见 evidence-policy.ts。
     */
    evidencePolicy: "content" | "literal";
    /** 策略来源：auto = 系统按标签语义自动判定；feedback = 审核反馈自动降级 */
    evidencePolicySource: "auto" | "feedback";
    /** 审核拒绝反馈：该标签"仅由 contentAnalysis 支持"却被人工拒绝的累计次数，达到阈值后自动降级为 literal */
    contentOnlyRejectionCount: number;
  }>;

  export type TaggingFaceFeatures = {
    faceCount: number;
    found: boolean;
  };

  export type TaggingQueueItemExtra = Partial<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: any; // LLM 返回的 usage 信息
    input: string; // 给 LLM 的 user message
    matchingSources: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy: "precise" | "balanced" | "broad";
    featureClassify: boolean;
    featureBrand: boolean;
    featureProduct: boolean;
    featurePerson: boolean;
    featureIp: boolean;
    /** Face-detection signals fed into AI tagging (from person feature recognition). */
    faceFeatures: TaggingFaceFeatures;
  }>;

  export type TaggingBrandRecommendedTag = {
    assetTagId: number;
    tagPath: string[];
  };

export type TaggingBrandBestMatch = {
  assetLogoId: string;
  logoName: string;
  logoTypeId: string | null;
  logoTypeName: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  recommendedTags: TaggingBrandRecommendedTag[];
};

  export type TaggingBrandRecommendation = {
    noConfidentMatch: boolean;
    bestMatch: TaggingBrandBestMatch | null;
    recommendedTags: TaggingBrandRecommendedTag[];
  };

  export type TaggingIpRecommendedTag = {
    assetTagId: number;
    tagPath: string[];
  };

export type TaggingIpBestMatch = {
  assetIpId: string;
  ipName: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: TaggingIpRecommendedTag[];
};

  export type TaggingIpRecommendation = {
    noConfidentMatch: boolean;
    bestMatch: TaggingIpBestMatch | null;
    recommendedTags: TaggingIpRecommendedTag[];
  };

  export type TaggingProductRecommendedTag = {
    assetTagId: number;
    tagPath: string[];
  };

export type TaggingProductBestMatch = {
  assetProductId: string;
  productName: string;
  productTypeId: string | null;
  productTypeName: string;
  description: string;
  generalCategory: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: TaggingProductRecommendedTag[];
};

  export type TaggingProductRecommendation = {
    noConfidentMatch: boolean;
    bestMatch: TaggingProductBestMatch | null;
    recommendedTags: TaggingProductRecommendedTag[];
  };

  export type TaggingPersonRecommendedTag = {
    assetTagId: number;
    tagPath: string[];
    assetPersonId: string;
    personName: string;
    detectionIndex: number;
    confidence: number;
  };

export type TaggingPersonMatch = {
  assetPersonId: string;
  personName: string;
  personTypeId: string | null;
  personTypeName: string;
  rawSimilarity: number;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  supportingReferenceCount: number;
  recommendedTags: TaggingPersonRecommendedTag[];
};

  export type TaggingPersonRecommendation = {
    noConfidentMatch: boolean;
    faceCount: number;
    faces: Array<{
      detectionIndex: number;
      box: {
        xMin: number;
        yMin: number;
        xMax: number;
        yMax: number;
        score: number;
        label: string;
      };
      topMatches: TaggingPersonMatch[];
      bestMatch: TaggingPersonMatch | null;
      noConfidentMatch: boolean;
    }>;
    recommendedTags: TaggingPersonRecommendedTag[];
  };

  import { SourceBasedTagPredictions, TagWithScore } from "@/app/(tagging)/types";
  export type TaggingQueueItemResult = Partial<{
    error: string;
    /** 失败时的可读错误信息（error 为错误码，message 为原始异常信息） */
    message: string;
    predictions: SourceBasedTagPredictions;
    tagsWithScore: TagWithScore[];
    brandRecommendation: TaggingBrandRecommendation | null;
    ipRecommendation: TaggingIpRecommendation | null;
    productRecommendation: TaggingProductRecommendation | null;
    personRecommendation: TaggingPersonRecommendation | null;
  }>;

  /** 标签树异步生成任务：存入 taggingQueueItem.extra */
  export type TagTreeGenerationJobExtra = {
    jobKind: "tag-tree-generation";
    prompt: string;
    lang: string;
    requestId?: string;
    userId: number;
  };

  /** 标签树异步生成任务：存入 taggingQueueItem.result */
  export type TagTreeGenerationJobResult = {
    text?: string;
    input?: string;
    error?: string;
  };
}
