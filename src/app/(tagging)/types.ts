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
