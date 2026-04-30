import "server-only";

import {
  PersonDetectionBox,
  PersonTopMatch,
  classifyPersonFaceEmbeddings,
  detectPersonFaceBoxes,
} from "@/lib/person/person-classification";
import type { TaggingPersonRecommendation, TaggingPersonRecommendedTag } from "@/prisma/client";

function normalizePersonRecommendedTags({
  tags,
  match,
}: {
  tags: PersonTopMatch["recommendedTags"];
  match: Pick<PersonTopMatch, "assetPersonId" | "personName" | "detectionIndex" | "confidence">;
}): TaggingPersonRecommendedTag[] {
  const seen = new Set<number>();

  return tags.flatMap((tag) => {
    if (!tag.assetTagId || seen.has(tag.assetTagId)) {
      return [];
    }

    seen.add(tag.assetTagId);

    return [
      {
        assetTagId: tag.assetTagId,
        tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
        assetPersonId: match.assetPersonId,
        personName: match.personName,
        detectionIndex: match.detectionIndex,
        confidence: match.confidence,
      },
    ];
  });
}

function normalizePersonMatch(match: PersonTopMatch) {
  return {
    assetPersonId: match.assetPersonId,
    personName: match.personName,
    personTypeId: match.personTypeId,
    personTypeName: match.personTypeName,
    similarity: match.similarity,
    confidence: match.confidence,
    detectionIndex: match.detectionIndex,
    supportingReferenceCount: match.supportingReferenceCount,
    recommendedTags: normalizePersonRecommendedTags({
      tags: match.recommendedTags,
      match,
    }),
  };
}

function serializeDetectionBox(box: PersonDetectionBox) {
  return {
    xMin: box.xMin,
    yMin: box.yMin,
    xMax: box.xMax,
    yMax: box.yMax,
    score: box.score,
    label: box.label,
  };
}

export async function classifyAssetPersonRecommendation({
  imageUrl,
  teamId,
}: {
  teamId: number;
  imageUrl?: string | null;
}): Promise<TaggingPersonRecommendation | null> {
  if (!imageUrl) {
    return null;
  }

  const detection = await detectPersonFaceBoxes({
    imageUrl,
    includeEmbedding: true,
  });

  const faces = detection.detections
    .map((box: PersonDetectionBox, detectionIndex: number) =>
      box.embedding
        ? {
            detectionIndex,
            box,
            embedding: box.embedding,
          }
        : null,
    )
    .filter(
      (face): face is { detectionIndex: number; box: PersonDetectionBox; embedding: number[] } =>
        Boolean(face),
    );

  if (faces.length === 0) {
    return {
      noConfidentMatch: true,
      faceCount: detection.faceCount,
      faces: detection.detections.map((box, detectionIndex) => ({
        detectionIndex,
        box: serializeDetectionBox(box),
        topMatches: [],
        bestMatch: null,
        noConfidentMatch: true,
      })),
      recommendedTags: [],
    };
  }

  const result = await classifyPersonFaceEmbeddings({
    teamId,
    faces,
  });

  const faceMap = new Map(result.faces.map((face) => [face.detectionIndex, face]));
  const recommendationFaces = detection.detections.map((box, detectionIndex) => {
    const face = faceMap.get(detectionIndex);

    if (!face) {
      return {
        detectionIndex,
        box: serializeDetectionBox(box),
        topMatches: [],
        bestMatch: null,
        noConfidentMatch: true,
      };
    }

    return {
      detectionIndex,
      box: serializeDetectionBox(box),
      topMatches: face.topMatches.map(normalizePersonMatch),
      bestMatch: face.bestMatch ? normalizePersonMatch(face.bestMatch) : null,
      noConfidentMatch: face.noConfidentMatch,
    };
  });

  const recommendedTags = recommendationFaces.flatMap((face) =>
    face.noConfidentMatch || !face.bestMatch ? [] : face.bestMatch.recommendedTags,
  );

  return {
    noConfidentMatch: recommendedTags.length === 0,
    faceCount: detection.faceCount,
    faces: recommendationFaces,
    recommendedTags,
  };
}
