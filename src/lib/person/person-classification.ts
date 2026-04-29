import "server-only";

import { queryPersonVectorPoints } from "@/lib/person/qdrant";
import prisma from "@/prisma/prisma";
import { PersonFaceDetectionBox, detectPersonFaces } from "./face-api";

const PERSON_VECTOR_QUERY_LIMIT = 24;
const PERSON_VECTOR_SCORE_THRESHOLD = 0.25;
const SUPPORTING_IMAGE_THRESHOLD = 0.36;
const MULTI_IMAGE_SUPPORT_BONUS = 0.015;
const MAX_SUPPORT_BONUS = 0.045;

const CONFIDENT_WINNER_HIGH_SIMILARITY = 0.55;
const CONFIDENT_WINNER_LOW_SIMILARITY = 0.36;
const CONFIDENT_WINNER_MIN_MARGIN = 0.06;

export type PersonDetectionBox = PersonFaceDetectionBox;

export type PersonTopMatch = {
  assetPersonId: string;
  personName: string;
  personTypeId: string | null;
  personTypeName: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  supportingReferenceCount: number;
  recommendedTags: Array<{
    id: string;
    assetTagId: number | null;
    tagPath: string[];
  }>;
};

export type PersonFaceClassificationResult = {
  detectionIndex: number;
  topMatches: PersonTopMatch[];
  bestMatch: PersonTopMatch | null;
  noConfidentMatch: boolean;
};

export type PersonClassificationResult = {
  faces: PersonFaceClassificationResult[];
};

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function similarityToConfidence(similarity: number) {
  const calibrated = 1 / (1 + Math.exp(-12 * (similarity - 0.38)));
  return clampConfidence(calibrated * 100);
}

function isConfidentWinner(topMatches: PersonTopMatch[]) {
  const best = topMatches[0];
  if (!best) {
    return false;
  }

  const secondSimilarity = topMatches[1]?.similarity ?? 0;
  const margin = best.similarity - secondSimilarity;

  if (best.similarity >= CONFIDENT_WINNER_HIGH_SIMILARITY) {
    return true;
  }

  if (best.similarity < CONFIDENT_WINNER_LOW_SIMILARITY) {
    return false;
  }

  return margin >= CONFIDENT_WINNER_MIN_MARGIN;
}

export async function detectPersonFaceBoxes({
  imageUrl,
  includeEmbedding = false,
}: {
  imageUrl: string;
  includeEmbedding?: boolean;
}) {
  const detection = await detectPersonFaces({
    imageUrl,
    includeEmbedding,
  });

  return {
    detections: detection.boxes,
    found: detection.found,
    faceCount: detection.faceCount,
  };
}

export async function classifyPersonFaceEmbeddings({
  teamId,
  faces,
}: {
  teamId: number;
  faces: Array<{
    detectionIndex: number;
    box: PersonDetectionBox;
    embedding: number[];
  }>;
}): Promise<PersonClassificationResult> {
  const faceResults = await Promise.all(
    faces.map(async (face) => {
      const matches = await queryPersonVectorPoints({
        teamId,
        vector: face.embedding,
        limit: PERSON_VECTOR_QUERY_LIMIT,
        scoreThreshold: PERSON_VECTOR_SCORE_THRESHOLD,
      });

      const rankedByPerson = new Map<
        string,
        {
          similarity: number;
          supportingReferenceIds: Set<string | number>;
        }
      >();

      for (const match of matches) {
        const assetPersonId = match.payload?.assetPersonId;
        if (!assetPersonId || typeof assetPersonId !== "string") {
          continue;
        }

        const current = rankedByPerson.get(assetPersonId) ?? {
          similarity: 0,
          supportingReferenceIds: new Set<string | number>(),
        };

        current.similarity = Math.max(current.similarity, match.score);
        if (match.score >= SUPPORTING_IMAGE_THRESHOLD) {
          current.supportingReferenceIds.add(match.id);
        }

        rankedByPerson.set(assetPersonId, current);
      }

      const matchedPersonIds = Array.from(rankedByPerson.keys());
      if (matchedPersonIds.length === 0) {
        return {
          detectionIndex: face.detectionIndex,
          topMatches: [],
          bestMatch: null,
          noConfidentMatch: true,
        } satisfies PersonFaceClassificationResult;
      }

      const persons = await prisma.assetPerson.findMany({
        where: {
          teamId,
          id: {
            in: matchedPersonIds,
          },
          enabled: true,
          status: "completed",
        },
        select: {
          id: true,
          name: true,
          personTypeId: true,
          personTypeName: true,
          tags: {
            orderBy: [{ sort: "asc" }, { id: "asc" }],
            select: {
              id: true,
              assetTagId: true,
              tagPath: true,
            },
          },
        },
      });

      const personMap = new Map(persons.map((person) => [person.id, person]));
      const topMatches = matchedPersonIds
        .map((assetPersonId) => {
          const stats = rankedByPerson.get(assetPersonId);
          const person = personMap.get(assetPersonId);

          if (!stats || !person) {
            return null;
          }

          const supportBonus = Math.min(
            MAX_SUPPORT_BONUS,
            Math.max(0, stats.supportingReferenceIds.size - 1) * MULTI_IMAGE_SUPPORT_BONUS,
          );
          const similarity = Math.min(0.99, stats.similarity + supportBonus);

          return {
            assetPersonId,
            personName: person.name,
            personTypeId: person.personTypeId,
            personTypeName: person.personTypeName,
            similarity,
            confidence: similarityToConfidence(similarity),
            detectionIndex: face.detectionIndex,
            supportingReferenceCount: stats.supportingReferenceIds.size,
            recommendedTags: person.tags.map((tag) => ({
              id: tag.id,
              assetTagId: tag.assetTagId,
              tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
            })),
          } satisfies PersonTopMatch;
        })
        .filter((match): match is PersonTopMatch => Boolean(match))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, 3);

      return {
        detectionIndex: face.detectionIndex,
        topMatches,
        bestMatch: topMatches[0] ?? null,
        noConfidentMatch: !isConfidentWinner(topMatches),
      } satisfies PersonFaceClassificationResult;
    }),
  );

  return {
    faces: faceResults.sort((left, right) => left.detectionIndex - right.detectionIndex),
  };
}
