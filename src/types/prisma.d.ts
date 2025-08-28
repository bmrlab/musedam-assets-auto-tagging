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
}
