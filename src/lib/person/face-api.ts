import "server-only";

import { getLogoDetectionServerToken, getLogoDetectionServerUrl } from "@/lib/brand/env";

export type FaceBoundingBox = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  width: number;
  height: number;
};

export type FaceKeypoint = {
  name: string;
  x: number;
  y: number;
};

export type FaceEmbeddingResponse = {
  vector: number[];
  dimension: number;
  norm: number;
  normalized: boolean;
  model_name: string;
};

export type FaceDetectionResponseItem = {
  bbox: FaceBoundingBox;
  confidence: number;
  keypoints?: FaceKeypoint[];
  landmarks_5?: FaceKeypoint[];
  arcface_input?: {
    input_size: number[];
    color_order: string;
    landmark_order: string[];
  };
  embedding?: FaceEmbeddingResponse | null;
};

type FaceDetectionServiceResponse = {
  detections?: FaceDetectionResponseItem[];
  face_count?: number;
  found?: boolean;
};

type GenerateFaceEmbeddingServiceResponse = {
  bbox: FaceBoundingBox;
  confidence: number;
  embedding: FaceEmbeddingResponse;
  arcface_input?: FaceDetectionResponseItem["arcface_input"];
};

export type PersonFaceDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
  embedding?: number[];
  embeddingModel?: string;
};

function mapFaceDetectionBox(face: FaceDetectionResponseItem): PersonFaceDetectionBox {
  return {
    xMin: face.bbox.x_min,
    yMin: face.bbox.y_min,
    xMax: face.bbox.x_max,
    yMax: face.bbox.y_max,
    score: face.confidence,
    label: "face",
    embedding: face.embedding?.vector,
    embeddingModel: face.embedding?.model_name,
  };
}

async function readErrorBody(response: Response) {
  const text = await response.text().catch(() => "");
  return text ? ` ${text}` : "";
}

export async function detectPersonFaces({
  imageUrl,
  includeEmbedding = false,
}: {
  imageUrl: string;
  includeEmbedding?: boolean;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const response = await fetch(`${baseUrl}/face_detection`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      include_embedding: includeEmbedding,
    }),
  });

  const payload = (await response.json().catch(() => null)) as FaceDetectionServiceResponse | null;
  if (!response.ok) {
    throw new Error(`Face detection request failed (${response.status})${await readErrorBody(response)}`);
  }

  const detections = payload?.detections ?? [];

  return {
    detections,
    boxes: detections.map(mapFaceDetectionBox),
    faceCount: payload?.face_count ?? detections.length,
    found: Boolean(payload?.found),
  };
}

export async function generateFaceEmbedding({
  imageUrl,
  face,
}: {
  imageUrl: string;
  face: FaceDetectionResponseItem;
}) {
  const baseUrl = getLogoDetectionServerUrl();
  const token = getLogoDetectionServerToken();
  const response = await fetch(`${baseUrl}/generate_face_embedding`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      face,
    }),
  });

  const payload = (await response
    .json()
    .catch(() => null)) as GenerateFaceEmbeddingServiceResponse | null;
  if (!response.ok || !payload?.embedding?.vector?.length) {
    throw new Error(`Generate face embedding request failed (${response.status})${await readErrorBody(response)}`);
  }

  return payload;
}
