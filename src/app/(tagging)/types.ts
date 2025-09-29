import z from "zod";

export const tagPredictionSchema = z.object({
  source: z.enum(["basicInfo", "materializedPath", "contentAnalysis", "tagKeywords"]),
  tags: z.array(
    z.object({
      confidence: z.number().min(0).max(1),
      leafTagId: z.number(),
      tagPath: z.array(z.string()).min(1).max(3),
    }),
  ),
});

/**
 * {
 *   confidence: number;
 *   leafTagId: number;
 *   tagPath: string[];
 * };
 */
export type TagPrediction = z.infer<typeof tagPredictionSchema>["tags"][number];

/**
 * {
 *   source: "basicInfo" | "materializedPath" | "contentAnalysis";
 *   tags: TagPrediction[];
 * }[];
 */
export type SourceBasedTagPredictions = z.infer<typeof tagPredictionSchema>[];

/**
 *
 * score 所有 source 的 confidence x 100 以后的加权得分，范围是 0 - 100
 */
export type TagWithScore = {
  leafTagId: number;
  tagPath: string[];
  confidenceBySources: Partial<Record<z.Infer<typeof tagPredictionSchema.shape.source>, number>>;
  score: number;
};

/**
 * Team Tagging Settings
 */

// 定义设置数据的schema
export const taggingSettingsSchema = z.object({
  isTaggingEnabled: z.boolean(),
  taggingMode: z.enum(["direct", "review"]),
  recognitionAccuracy: z.enum(["precise", "balanced", "broad"]),
  matchingSources: z.object({
    basicInfo: z.boolean(),
    materializedPath: z.boolean(),
    contentAnalysis: z.boolean(),
    tagKeywords: z.boolean(),
  }),
  triggerTiming: z.object({
    autoRealtimeTagging: z.boolean(),
    manualTriggerTagging: z.boolean(),
    scheduledTagging: z.boolean(),
  }),
  applicationScope: z.object({
    scopeType: z.enum(["all", "specific"]),
    selectedFolders: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
      }),
    ),
  }),
});

export type TaggingSettingsData = z.infer<typeof taggingSettingsSchema>;

// 配置项的 key 定义
export const TAGGING_CONFIG_KEYS = {
  IS_TAGGING_ENABLED: "isTaggingEnabled",
  TAGGING_MODE: "taggingMode",
  RECOGNITION_ACCURACY: "recognitionAccuracy",
  MATCHING_SOURCES: "matchingSources",
  TRIGGER_TIMING: "triggerTiming",
  APPLICATION_SCOPE: "applicationScope",
  ACCESS_PERMISSIONS: "accessPermissions",
} as const;

// 默认设置
export const DEFAULT_TAGGING_SETTINGS: TaggingSettingsData = {
  isTaggingEnabled: true,
  taggingMode: "review",
  recognitionAccuracy: "balanced",
  matchingSources: {
    basicInfo: true,
    materializedPath: true,
    contentAnalysis: true,
    tagKeywords: true,
  },
  triggerTiming: {
    autoRealtimeTagging: true,
    manualTriggerTagging: true,
    scheduledTagging: false,
  },
  applicationScope: {
    scopeType: "all",
    selectedFolders: [],
  },
};

// Permission settings
export type AccessRole = "reviewer" | "admin";
export interface AccessPermission {
  slug: string;
  name: string;
  role: AccessRole;
}
