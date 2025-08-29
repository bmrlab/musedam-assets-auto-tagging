import { z } from "zod";

export const tokenLoginPayloadSchema = z.object({
  user: z.object({
    id: z
      .union([z.string().regex(/^\d+$/, "String must contain only digits"), z.number()])
      .transform((value) => Number(value)),
    name: z.string(),
  }),
  team: z.object({
    id: z
      .union([z.string().regex(/^\d+$/, "String must contain only digits"), z.number()])
      .transform((value) => Number(value)),
    name: z.string(),
  }),
  timestamp: z.number(),
  expiresAt: z.number(),
});
