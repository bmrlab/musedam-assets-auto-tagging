import { decryptText, encryptText } from "@/lib/cipher";

export interface ImpersonationLoginPayload {
  musedamUserId: number;
  musedamTeamId: number;
  timestamp: number;
  expiresAt: number;
}

/**
 * Generate a impersonation login token for a user
 * @param userId - The user ID to generate token for
 * @param expiryHours - How many hours the token should be valid (default: 24)
 * @returns The encrypted token string
 */
export function generateImpersonationLoginToken({
  musedamUserId,
  musedamTeamId,
  expiryHours = 24,
}: {
  musedamUserId: number;
  musedamTeamId: number;
  expiryHours?: number;
}): string {
  const now = Date.now();
  const expiresAt = now + expiryHours * 60 * 60 * 1000; // Convert hours to milliseconds

  const payload: ImpersonationLoginPayload = {
    musedamUserId,
    musedamTeamId,
    timestamp: now,
    expiresAt,
  };

  return encryptText(JSON.stringify(payload));
}

/**
 * Verify and decode a impersonation login token
 * @param token - The encrypted token to verify
 * @returns The decoded payload if valid, null if invalid or expired
 */
export function verifyImpersonationLoginToken(token: string): ImpersonationLoginPayload | null {
  try {
    const decryptedText = decryptText(token);
    const payload: ImpersonationLoginPayload = JSON.parse(decryptedText);

    // Check if token has expired
    if (Date.now() > payload.expiresAt) {
      return null;
    }

    // Validate payload structure
    if (
      typeof payload.musedamUserId !== "string" ||
      typeof payload.musedamTeamId !== "string" ||
      typeof payload.timestamp !== "number" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }

    return payload;
  } catch (error) {
    console.log(error);
    // Decryption failed or invalid JSON
    return null;
  }
}

/**
 * Generate a complete impersonation login URL
 * @param userId - The user ID to generate URL for
 * @param siteOrigin - The site origin URL (e.g., "https://example.com")
 * @param expiryHours - How many hours the token should be valid (default: 24)
 * @returns The complete impersonation login URL
 */
export function generateImpersonationLoginUrl({
  siteOrigin,
  musedamUserId,
  musedamTeamId,
  expiryHours = 24,
}: {
  siteOrigin: string;
  musedamUserId: number;
  musedamTeamId: number;
  expiryHours?: number;
}): string {
  const token = generateImpersonationLoginToken({
    musedamUserId,
    musedamTeamId,
    expiryHours,
  });
  return `${siteOrigin}/auth/impersonation-login?token=${encodeURIComponent(token)}`;
}
