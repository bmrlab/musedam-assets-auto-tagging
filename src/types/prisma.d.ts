declare module "@/prisma/client" {
  export * from "@/prisma/client/index";
  import { Tag } from "@/prisma/client";

  export type TagWithChildren = Pick<Tag, "id" | "name"> & {
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

  import { SourceBasedTagPredictions, TagWithScore } from "@/app/(tagging)/types";
  export type TaggingQueueItemResult = Partial<{
    error: string;
    predictions: SourceBasedTagPredictions;
    tagsWithScore: TagWithScore[];
  }>;
}
