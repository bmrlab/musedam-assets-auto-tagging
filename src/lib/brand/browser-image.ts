"use client";

import {
  MAX_CLIENT_IMAGE_UPLOAD_BYTES,
  TARGET_COMPRESSED_IMAGE_BYTES,
} from "@/lib/brand/upload-constants";

export const CLIENT_IMAGE_PREPARATION_ERROR_CODES = {
  fileTooLarge: "file_too_large",
  imageLoadFailed: "image_load_failed",
  compressionFailed: "compression_failed",
  compressionTargetUnreachable: "compression_target_unreachable",
} as const;

export type ClientImagePreparationErrorCode =
  (typeof CLIENT_IMAGE_PREPARATION_ERROR_CODES)[keyof typeof CLIENT_IMAGE_PREPARATION_ERROR_CODES];

const MAX_CLIENT_IMAGE_DIMENSION = 4096;
const MAX_COMPRESSION_ATTEMPTS = 10;
const INITIAL_COMPRESSION_QUALITY = 0.9;
const MIN_COMPRESSION_QUALITY = 0.45;
const COMPRESSION_QUALITY_DECREMENT = 0.08;
const MIN_IMAGE_SCALE = 0.12;
const SCALE_FACTOR_FLOOR = 0.5;
const SCALE_FACTOR_CEILING = 0.92;
const SCALE_FACTOR_BUFFER = 0.98;

class ClientImagePreparationError extends Error {
  code: ClientImagePreparationErrorCode;

  constructor(code: ClientImagePreparationErrorCode) {
    super(code);
    this.code = code;
  }
}

function createPreparationError(code: ClientImagePreparationErrorCode) {
  return new ClientImagePreparationError(code);
}

function replaceFileExtension(filename: string, extension: string) {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  if (/\.[^.]+$/.test(filename)) {
    return filename.replace(/\.[^.]+$/, normalizedExtension);
  }

  return filename + normalizedExtension;
}

function getOutputMimeType(file: File) {
  if (file.type === "image/jpeg" || file.type === "image/jpg") {
    return "image/jpeg";
  }

  return "image/webp";
}

function getOutputExtension(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "image/webp") {
    return ".webp";
  }

  return ".png";
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.imageLoadFailed));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export function getClientImagePreparationErrorCode(error: unknown) {
  if (error instanceof ClientImagePreparationError) {
    return error.code;
  }

  return null;
}

export async function prepareClientImageUpload(file: File) {
  if (file.size > MAX_CLIENT_IMAGE_UPLOAD_BYTES) {
    throw createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.fileTooLarge);
  }

  if (file.size <= TARGET_COMPRESSED_IMAGE_BYTES) {
    return file;
  }

  const image = await loadImageFromFile(file);
  const outputMimeType = getOutputMimeType(file);
  const maxEdge = Math.max(image.naturalWidth, image.naturalHeight);
  let scale = maxEdge > 0 ? Math.min(1, MAX_CLIENT_IMAGE_DIMENSION / maxEdge) : 1;
  let quality = INITIAL_COMPRESSION_QUALITY;
  let bestBlob: Blob | null = null;

  for (let attempt = 0; attempt < MAX_COMPRESSION_ATTEMPTS; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      throw createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed);
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, outputMimeType, quality);
    if (!blob) {
      throw createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed);
    }

    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }

    if (blob.size <= TARGET_COMPRESSED_IMAGE_BYTES) {
      return new File([blob], replaceFileExtension(file.name, getOutputExtension(blob.type)), {
        type: blob.type,
        lastModified: Date.now(),
      });
    }

    const scaleFactor = Math.max(
      SCALE_FACTOR_FLOOR,
      Math.min(
        SCALE_FACTOR_CEILING,
        Math.sqrt(TARGET_COMPRESSED_IMAGE_BYTES / blob.size) * SCALE_FACTOR_BUFFER,
      ),
    );
    scale = Math.max(MIN_IMAGE_SCALE, scale * scaleFactor);
    quality = Math.max(MIN_COMPRESSION_QUALITY, quality - COMPRESSION_QUALITY_DECREMENT);
  }

  if (!bestBlob) {
    throw createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed);
  }

  throw createPreparationError(CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionTargetUnreachable);
}
