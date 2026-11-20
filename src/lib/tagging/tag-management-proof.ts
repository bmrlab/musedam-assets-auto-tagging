import { createHmac, timingSafeEqual } from "node:crypto";
import "server-only";
import { z } from "zod";

export const TAG_MANAGEMENT_PROOF_HEADER = "x-tag-management-proof";
export const TAG_MANAGEMENT_PROOF_TTL_MS = 30_000;
const schema = z.object({
  scope: z.literal("tag-management"),
  userId: z.number().int().positive(),
  teamId: z.number().int().positive(),
  expiresAt: z.number().int(),
});

function sign(payload: string) {
  const secret = process.env.CIPHER_PASSWORD;
  if (!secret) throw new Error("Tag authorization is not configured");
  return createHmac("sha256", secret).update(`tag-management:${payload}`).digest();
}

/** 只签发本应用的短效标签管理凭据，不包含主站登录 token。 */
export function issueTagManagementProof(userId: number, teamId: number) {
  const expiresAt = Date.now() + TAG_MANAGEMENT_PROOF_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify(schema.parse({ scope: "tag-management", userId, teamId, expiresAt })),
  ).toString("base64url");
  return { proof: `${payload}.${sign(payload).toString("base64url")}`, expiresAt };
}

export function verifyTagManagementProof(proof: string | null, userId: number, teamId: number) {
  try {
    if (!proof || proof.length > 2048) return false;
    const parts = proof.split(".");
    if (parts.length !== 2) return false;
    const expected = sign(parts[0]);
    const signature = Buffer.from(parts[1], "base64url");
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false;
    const data = schema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    return (
      data.userId === userId &&
      data.teamId === teamId &&
      data.expiresAt > Date.now() &&
      data.expiresAt <= Date.now() + TAG_MANAGEMENT_PROOF_TTL_MS
    );
  } catch {
    return false;
  }
}
