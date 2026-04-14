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
    size: number;
    extension: string;
  }>;

  export type AssetTagExtra = Partial<{
    description: string;
    keywords: string[];
    negativeKeywords: string[];
  }>;

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
  }>;

  export type TaggingBrandRecommendedTag = {
    assetTagId: number;
    tagPath: string[];
  };

  export type TaggingBrandRecommendation = {
    noConfidentMatch: boolean;
    bestMatch: null | {
      assetLogoId: string;
      logoName: string;
      logoTypeId: string | null;
      logoTypeName: string;
      similarity: number;
      confidence: number;
      detectionIndex: number;
    };
    recommendedTags: TaggingBrandRecommendedTag[];
  };

  import { SourceBasedTagPredictions, TagWithScore } from "@/app/(tagging)/types";
  export type TaggingQueueItemResult = Partial<{
    error: string;
    predictions: SourceBasedTagPredictions;
    tagsWithScore: TagWithScore[];
    brandRecommendation: TaggingBrandRecommendation | null;
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
