import "server-only";

import { queryPersonVectorCandidates } from "@/lib/person/pgvector";
import prisma from "@/prisma/prisma";
import pLimit from "p-limit";
import { PersonFaceDetectionBox, detectPersonFaces } from "./face-api";
import {
  PERSON_VECTOR_CANDIDATE_SCORE_FLOOR,
  evaluatePersonMatchCandidates,
} from "./person-match-policy";

const PERSON_CANDIDATE_IDENTITY_LIMIT = 24;
const PERSON_FACE_QUERY_CONCURRENCY = 4;
const SUPPORTING_IMAGE_THRESHOLD = 0.36;
const MULTI_IMAGE_SUPPORT_BONUS = 0.015;
const MAX_SUPPORT_BONUS = 0.045;

export type PersonDetectionBox = PersonFaceDetectionBox;

export type PersonTopMatch = {
  assetPersonId: string;
  personName: string;
  personTypeId: string | null;
  personTypeName: string;
  rawSimilarity: number;
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

export async function detectPersonFaceBoxes({
  imageBase64,
  includeEmbedding = false,
}: {
  imageBase64: string;
  includeEmbedding?: boolean;
}) {
  const detection = await detectPersonFaces({
    imageBase64,
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
  const classifyFace = pLimit(PERSON_FACE_QUERY_CONCURRENCY);
  const faceResults = await Promise.all(
    faces.map((face) =>
      classifyFace(async () => {
        const matches = await queryPersonVectorCandidates({
          teamId,
          vector: face.embedding,
          limit: PERSON_CANDIDATE_IDENTITY_LIMIT,
          candidateScoreFloor: PERSON_VECTOR_CANDIDATE_SCORE_FLOOR,
          supportingScoreThreshold: SUPPORTING_IMAGE_THRESHOLD,
        });

        const rankedByPerson = new Map<
          string,
          {
            similarity: number;
            supportingReferenceCount: number;
          }
        >();

        for (const match of matches) {
          const assetPersonId = match.assetPersonId;
          if (!assetPersonId || typeof assetPersonId !== "string") {
            continue;
          }

          rankedByPerson.set(assetPersonId, {
            similarity: match.rawSimilarity,
            supportingReferenceCount: match.supportingReferenceCount,
          });
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
              Math.max(0, stats.supportingReferenceCount - 1) * MULTI_IMAGE_SUPPORT_BONUS,
            );
            const rawSimilarity = stats.similarity;
            const similarity = Math.min(0.99, rawSimilarity + supportBonus);

            return {
              assetPersonId,
              personName: person.name,
              personTypeId: person.personTypeId,
              personTypeName: person.personTypeName,
              rawSimilarity,
              similarity,
              confidence: similarityToConfidence(similarity),
              detectionIndex: face.detectionIndex,
              supportingReferenceCount: stats.supportingReferenceCount,
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
          noConfidentMatch: !evaluatePersonMatchCandidates(topMatches).accepted,
        } satisfies PersonFaceClassificationResult;
      }),
    ),
  );

  return {
    faces: faceResults.sort((left, right) => left.detectionIndex - right.detectionIndex),
  };
}
