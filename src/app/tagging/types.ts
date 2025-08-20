import z from "zod";

export const tagPredictionSchema = z.object({
  source: z.enum(["basicInfo", "materializedPath", "contentAnalysis"]),
  tags: z.array(
    z.object({
      confidence: z.number().min(0).max(1),
      leafTagId: z.number(),
      tagPath: z.array(z.string()).min(1).max(3),
    }),
  ),
});

export type TagPrediction = z.infer<typeof tagPredictionSchema>["tags"][number];
// {
//   confidence: number;
//   leafTagId: number;
//   tagPath: string[];
// };

export type SourceBasedTagPredictions = z.infer<typeof tagPredictionSchema>[];
// {
//   source: "basicInfo" | "materializedPath" | "contentAnalysis";
//   tags: TagPrediction[];
// }[];
