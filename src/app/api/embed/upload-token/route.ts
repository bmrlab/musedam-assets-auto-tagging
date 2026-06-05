import authOptions from "@/app/(auth)/authOptions";
import {
  createOssUploadTokenCookie,
  encodeOssUploadTokenCookie,
  getUploadTokenMaxAgeSeconds,
  normalizeOssUploadTokenInput,
  OSS_UPLOAD_TOKEN_COOKIE,
  setStoredOssUploadToken,
} from "@/lib/oss-upload-token";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const tokenInput = normalizeOssUploadTokenInput(
      body.uploadToken !== undefined && typeof body.uploadToken === "object"
        ? body.uploadToken
        : body,
    );
    const token = createOssUploadTokenCookie(tokenInput);
    const cookieStore = await cookies();

    cookieStore.set(OSS_UPLOAD_TOKEN_COOKIE, encodeOssUploadTokenCookie(token), {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      path: "/",
      maxAge: getUploadTokenMaxAgeSeconds(token),
    });

    const session = await getServerSession(authOptions);
    if (session?.user?.id != null && session?.team?.id != null) {
      setStoredOssUploadToken(session.team.id, String(session.user.id), token);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Invalid OSS upload token",
      },
      { status: 400 },
    );
  }
}
