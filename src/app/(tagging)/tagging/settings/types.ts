import { z } from "zod";

// 定义设置数据的schema
export const SettingsSchema = z.object({
  isTaggingEnabled: z.boolean(),
  taggingMode: z.enum(["direct", "review"]),
  recognitionMode: z.enum(["precise", "balanced", "broad"]),
  matchingStrategies: z.object({
    filePath: z.boolean(),
    materialName: z.boolean(),
    materialContent: z.boolean(),
    tagKeywords: z.boolean(),
  }),
  applicationScope: z.object({
    scopeType: z.enum(["all", "specific"]),
    selectedFolders: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
      }),
    ),
  }),
});

export type SettingsData = z.infer<typeof SettingsSchema>;

// 配置项的 key 定义
export const CONFIG_KEYS = {
  IS_TAGGING_ENABLED: "isTaggingEnabled",
  TAGGING_MODE: "taggingMode",
  RECOGNITION_MODE: "recognitionMode",
  MATCHING_STRATEGIES: "matchingStrategies",
  APPLICATION_SCOPE: "applicationScope",
} as const;

// 默认设置
export const DEFAULT_SETTINGS: SettingsData = {
  isTaggingEnabled: true,
  taggingMode: "review",
  recognitionMode: "balanced",
  matchingStrategies: {
    filePath: true,
    materialName: true,
    materialContent: true,
    tagKeywords: true,
  },
  applicationScope: {
    scopeType: "all",
    selectedFolders: [],
  },
};