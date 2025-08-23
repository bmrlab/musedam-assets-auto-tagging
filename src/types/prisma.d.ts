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

  export type AssetObjectExtra = Partial<{
    thumbnailAccessUrl: string;
  }>;
}
