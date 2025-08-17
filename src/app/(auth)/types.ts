import { z } from "zod";

export const tokenLoginPayloadSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
  }),
  team: z.object({
    id: z.string(),
    name: z.string(),
  }),
  timestamp: z.number(),
  expiresAt: z.number(),
});

export type TokenLoginPayloadType = z.infer<typeof tokenLoginPayloadSchema>;
