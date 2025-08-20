import z from "zod";

export type TagPrediction = {
  tagPath: string[];
  confidence: number;
  leafTagId: number;
};

export type SourceBasedTagPredictions = {
  filename: TagPrediction[];
  filepath: TagPrediction[];
  content: TagPrediction[];
};

export const tagPredictionSchema = z.object({
  filename: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
      leafTagId: z.number(),
    }),
  ),
  filepath: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
      leafTagId: z.number(),
    }),
  ),
  content: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
      leafTagId: z.number(),
    }),
  ),
});
