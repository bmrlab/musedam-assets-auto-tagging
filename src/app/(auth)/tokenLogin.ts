import { decryptText, encryptText } from "@/lib/cipher";
import z from "zod";
import { tokenLoginPayloadSchema } from "./types";

export function generateTokenLoginCredential({
  user,
  team,
  expiryHours = 24,
}: Pick<z.infer<typeof tokenLoginPayloadSchema>, "user" | "team"> & {
  expiryHours?: number;
}): string {
  const now = Date.now();
  const expiresAt = now + expiryHours * 60 * 60 * 1000; // Convert hours to milliseconds

  const payload: z.infer<typeof tokenLoginPayloadSchema> = {
    user,
    team,
    timestamp: now,
    expiresAt,
  };

  return encryptText(JSON.stringify(payload));
}

export function verifyTokenLoginCredential(
  token: string,
): z.infer<typeof tokenLoginPayloadSchema> | null {
  const decryptedText = decryptText(token);
  const payloadData = JSON.parse(decryptedText);

  const payloadParseResult = tokenLoginPayloadSchema.safeParse(payloadData);
  if (!payloadParseResult.success) {
    return null;
  }

  const payload = payloadParseResult.data;

  if (Date.now() > payload.expiresAt) {
    return null;
  }

  return payload;
}
