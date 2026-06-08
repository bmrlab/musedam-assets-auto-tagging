import { signS3ObjectUploadUrl, signS3ObjectUrl, verifyBrowserS3ObjectProxyUrl } from "@/lib/s3";
import { createReadStream } from "fs";
import { mkdir, open, readFile, rm, writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from "os";
import path from "path";

export const runtime = "nodejs";

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "etag",
  "last-modified",
  "cache-control",
];

type S3ObjectRouteContext = {
  params: Promise<{ objectKey?: string[] }>;
};

type ChunkUploadMetadata = {
  uploadId: string;
  chunkIndex: number;
  chunkCount: number;
};

function getChunkUploadMetadata(request: NextRequest): ChunkUploadMetadata | null {
  const uploadId = request.headers.get("x-s3-proxy-upload-id");
  const chunkIndex = Number(request.headers.get("x-s3-proxy-chunk-index"));
  const chunkCount = Number(request.headers.get("x-s3-proxy-chunk-count"));

  if (!uploadId) {
    return null;
  }

  if (
    !/^[a-zA-Z0-9._-]+$/.test(uploadId) ||
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(chunkCount) ||
    chunkIndex < 0 ||
    chunkCount < 1 ||
    chunkIndex >= chunkCount
  ) {
    return null;
  }

  return {
    uploadId,
    chunkIndex,
    chunkCount,
  };
}

function getChunkUploadDir(uploadId: string) {
  return path.join(tmpdir(), "auto-tag-s3-proxy-uploads", uploadId);
}

async function writeUploadChunk(request: NextRequest, metadata: ChunkUploadMetadata) {
  const uploadDir = getChunkUploadDir(metadata.uploadId);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(
    path.join(uploadDir, `${metadata.chunkIndex}.part`),
    Buffer.from(await request.arrayBuffer()),
  );
}

async function createChunkReadStream(metadata: ChunkUploadMetadata) {
  const uploadDir = getChunkUploadDir(metadata.uploadId);
  const combinedPath = path.join(uploadDir, "combined-upload.bin");
  const combinedFile = await open(combinedPath, "w");

  try {
    for (let chunkIndex = 0; chunkIndex < metadata.chunkCount; chunkIndex += 1) {
      const chunk = await readFile(path.join(uploadDir, `${chunkIndex}.part`));
      await combinedFile.write(chunk);
    }
  } finally {
    await combinedFile.close();
  }

  return {
    body: createReadStream(combinedPath),
    cleanup: () => rm(uploadDir, { recursive: true, force: true }),
  };
}

async function getVerifiedObjectKey(request: NextRequest, context: S3ObjectRouteContext) {
  const { objectKey: objectKeyParts = [] } = await context.params;
  const objectKey = objectKeyParts.join("/");
  const signedUrlExpiresAt = Number(request.nextUrl.searchParams.get("expiresAt"));
  const signature = request.nextUrl.searchParams.get("signature");

  if (
    !objectKey ||
    !verifyBrowserS3ObjectProxyUrl({
      method: request.method === "PUT" ? "PUT" : "GET",
      objectKey,
      signature,
      signedUrlExpiresAt,
    })
  ) {
    return null;
  }

  return {
    objectKey,
    expiresInSeconds: Math.max(Math.ceil((signedUrlExpiresAt - Date.now()) / 1000), 1),
  };
}

export async function GET(request: NextRequest, context: S3ObjectRouteContext) {
  const verified = await getVerifiedObjectKey(request, context);

  if (!verified) {
    return NextResponse.json({ success: false, message: "Invalid image URL" }, { status: 403 });
  }

  const { signedUrl } = signS3ObjectUrl({
    objectKey: verified.objectKey,
    expiresInSeconds: verified.expiresInSeconds,
  });
  const response = await fetch(signedUrl);

  if (!response.ok || !response.body) {
    return NextResponse.json(
      { success: false, message: "Image not found" },
      { status: response.status },
    );
  }

  const headers = new Headers();

  for (const header of PASSTHROUGH_HEADERS) {
    const value = response.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  headers.set("Cache-Control", headers.get("Cache-Control") || "private, max-age=300");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function PUT(request: NextRequest, context: S3ObjectRouteContext) {
  const verified = await getVerifiedObjectKey(request, context);

  if (!verified) {
    return NextResponse.json({ success: false, message: "Invalid upload URL" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const chunkMetadata = getChunkUploadMetadata(request);

  if (request.headers.get("x-s3-proxy-upload-id") && !chunkMetadata) {
    return NextResponse.json({ success: false, message: "Invalid upload chunk" }, { status: 400 });
  }

  if (chunkMetadata) {
    await writeUploadChunk(request, chunkMetadata);

    if (chunkMetadata.chunkIndex < chunkMetadata.chunkCount - 1) {
      return NextResponse.json({ success: true });
    }
  }

  const { signedUrl } = signS3ObjectUploadUrl({
    objectKey: verified.objectKey,
    contentType,
    expiresInSeconds: verified.expiresInSeconds,
  });
  const chunkUpload = chunkMetadata ? await createChunkReadStream(chunkMetadata) : null;
  const uploadBody = chunkUpload ? (chunkUpload.body as unknown as BodyInit) : request.body;
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-acl": "public-read",
    },
    body: uploadBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await chunkUpload?.cleanup();

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return NextResponse.json(
      { success: false, message: errorText || "Upload failed" },
      { status: response.status },
    );
  }

  const headers = new Headers();
  const etag = response.headers.get("etag");

  if (etag) {
    headers.set("ETag", etag);
  }

  return new Response(null, {
    status: response.status,
    headers,
  });
}
