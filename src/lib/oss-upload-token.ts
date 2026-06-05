import "server-only";

import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { z } from "zod";

import type { OssObjectLocation } from "./oss-types";

export const OSS_UPLOAD_TOKEN_COOKIE = "musedam-upload-token";
const OSS_UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;
const OSS_UPLOAD_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

const uploadTokenInputSchema = z.object({
  bucket: z.string().trim().min(1).max(255),
  stsAccessSecurityToken: z.string().trim().min(1),
  stsEndPoint: z.string().trim().url(),
  stsRegion: z.string().trim().min(1).max(64),
  stsAccessKeyId: z.string().trim().min(1),
  stsAccessKeySecret: z.string().trim().min(1),
  key: z.string().trim().min(1).max(255),
});

const uploadTokenCookieSchema = uploadTokenInputSchema.extend({
  updatedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

export type OssUploadTokenInput = z.infer<typeof uploadTokenInputSchema>;
export type OssUploadToken = z.infer<typeof uploadTokenCookieSchema>;

type StoredOssUploadTokenKey = `${number}:${string}`;

const storedOssUploadTokens = new Map<StoredOssUploadTokenKey, OssUploadToken>();

function getStoredOssUploadTokenKey(teamId: number, userId: string): StoredOssUploadTokenKey {
  return `${teamId}:${userId}`;
}

export function setStoredOssUploadToken(teamId: number, userId: string, token: OssUploadToken) {
  storedOssUploadTokens.set(getStoredOssUploadTokenKey(teamId, userId), token);
}

function getStoredOssUploadToken(teamId: number, userId: string): OssUploadToken | null {
  const token = storedOssUploadTokens.get(getStoredOssUploadTokenKey(teamId, userId));

  if (!token) {
    return null;
  }

  if (token.expiresAt <= Date.now() + OSS_UPLOAD_TOKEN_REFRESH_BUFFER_MS) {
    storedOssUploadTokens.delete(getStoredOssUploadTokenKey(teamId, userId));
    return null;
  }

  return token;
}

function isValidOssUploadToken(token: OssUploadToken | null): token is OssUploadToken {
  return !!token && token.expiresAt > Date.now() + OSS_UPLOAD_TOKEN_REFRESH_BUFFER_MS;
}

export function normalizeOssUploadTokenInput(input: unknown): OssUploadTokenInput {
  return uploadTokenInputSchema.parse(input);
}

export function createOssUploadTokenCookie(input: OssUploadTokenInput): OssUploadToken {
  const now = Date.now();

  return {
    ...input,
    updatedAt: now,
    expiresAt: now + OSS_UPLOAD_TOKEN_TTL_MS,
  };
}

export function getUploadTokenMaxAgeSeconds(token: OssUploadToken) {
  return Math.max(0, Math.floor((token.expiresAt - Date.now()) / 1000));
}

export function encodeOssUploadTokenCookie(token: OssUploadToken) {
  return Buffer.from(JSON.stringify(uploadTokenCookieSchema.parse(token)), "utf8").toString(
    "base64url",
  );
}

export function decodeOssUploadTokenCookie(value: string): OssUploadToken | null {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    return uploadTokenCookieSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

export async function getCurrentOssUploadToken(): Promise<OssUploadToken> {
  const cookieStore = await cookies();
  const encodedToken = cookieStore.get(OSS_UPLOAD_TOKEN_COOKIE)?.value;
  let token = encodedToken ? decodeOssUploadTokenCookie(encodedToken) : null;

  if (!isValidOssUploadToken(token)) {
    const session = await getServerSession(authOptions);
    if (session?.user?.id != null && session?.team?.id != null) {
      token = getStoredOssUploadToken(session.team.id, String(session.user.id));
    }
  }

  if (!isValidOssUploadToken(token)) {
    throw new Error("Missing OSS upload token. Please wait for MuseDAM to refresh upload token.");
  }

  return token;
}

export function getOssLocationFromUploadToken(token: OssUploadToken): OssObjectLocation {
  return {
    ossBucket: token.bucket,
    ossEndpoint: token.stsEndPoint,
    ossRegion: token.stsRegion,
  };
}

export function getUploadTokenBoundedExpiresInSeconds({
  token,
  requestedExpiresInSeconds,
}: {
  token: OssUploadToken;
  requestedExpiresInSeconds: number;
}) {
  const tokenExpiresInSeconds = Math.floor(
    (token.expiresAt - Date.now() - OSS_UPLOAD_TOKEN_REFRESH_BUFFER_MS) / 1000,
  );
  const expiresInSeconds = Math.min(requestedExpiresInSeconds, tokenExpiresInSeconds);

  if (expiresInSeconds <= 0) {
    throw new Error("OSS upload token expired. Please wait for MuseDAM to refresh upload token.");
  }

  return expiresInSeconds;
}
