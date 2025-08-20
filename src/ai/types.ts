import z from "zod";

export interface TagPrediction {
  tagPath: string[];
  confidence: number;
}

export interface SourceBasedTagPredictions {
  filename: TagPrediction[];
  filepath: TagPrediction[];
  content: TagPrediction[];
}

export const tagPredictionSchema = z.object({
  filename: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
    }),
  ),
  filepath: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
    }),
  ),
  content: z.array(
    z.object({
      tagPath: z.array(z.string()).min(1).max(3),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
