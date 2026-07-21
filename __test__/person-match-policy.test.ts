import { getAcceptedPersonRecommendationTagIds } from "@/app/(tagging)/person-recommendation";
import {
  evaluatePersonMatchCandidates,
  isAcceptedPersonFace,
  type PersonMatchPolicyCandidate,
} from "@/lib/person/person-match-policy";
import { collectMuseFeatureIdentifierIdsForQueueItem } from "@/musedam/collect-muse-feature-identifier-ids";
import type { TaggingPersonRecommendation } from "@/prisma/client";
import { describe, expect, it } from "vitest";

function candidate(
  assetPersonId: string,
  rawSimilarity: number,
  similarity = rawSimilarity,
): PersonMatchPolicyCandidate {
  return {
    assetPersonId,
    rawSimilarity,
    similarity,
  };
}

function match({
  assetPersonId,
  rawSimilarity,
  similarity = rawSimilarity,
  tagId,
  detectionIndex,
}: {
  assetPersonId: string;
  rawSimilarity: number;
  similarity?: number;
  tagId: number;
  detectionIndex: number;
}) {
  return {
    assetPersonId,
    personName: assetPersonId,
    personTypeId: null,
    personTypeName: "Person",
    rawSimilarity,
    similarity,
    confidence: 90,
    detectionIndex,
    supportingReferenceCount: 1,
    recommendedTags: [
      {
        assetTagId: tagId,
        tagPath: ["People", assetPersonId],
        assetPersonId,
        personName: assetPersonId,
        detectionIndex,
        confidence: 90,
      },
    ],
  };
}

function face({
  best,
  runners = [],
  noConfidentMatch,
}: {
  best: ReturnType<typeof match>;
  runners?: ReturnType<typeof match>[];
  noConfidentMatch: boolean;
}) {
  return {
    detectionIndex: best.detectionIndex,
    box: {
      xMin: 0,
      yMin: 0,
      xMax: 10,
      yMax: 10,
      score: 1,
      label: "face",
    },
    topMatches: [best, ...runners],
    bestMatch: best,
    noConfidentMatch,
  };
}

describe("person automatic-match policy", () => {
  it("rejects a weak nearest neighbor", () => {
    const decision = evaluatePersonMatchCandidates([
      candidate("unknown-best", 0.4),
      candidate("runner-up", 0.3),
    ]);

    expect(decision).toMatchObject({
      accepted: false,
      reason: "below_similarity_threshold",
    });
  });

  it("rejects a strong but ambiguous nearest neighbor", () => {
    const decision = evaluatePersonMatchCandidates([
      candidate("best", 0.65),
      candidate("lookalike", 0.62),
    ]);

    expect(decision).toMatchObject({
      accepted: false,
      reason: "ambiguous_runner_up",
    });
    expect(decision.margin).toBeCloseTo(0.03);
  });

  it("accepts a strong winner with a clear margin", () => {
    const decision = evaluatePersonMatchCandidates([
      candidate("best", 0.66),
      candidate("runner-up", 0.5),
    ]);

    expect(decision).toMatchObject({
      accepted: true,
      reason: "accepted",
    });
  });

  it("does not let the supporting-image bonus cross the raw acceptance boundary", () => {
    const decision = evaluatePersonMatchCandidates([
      candidate("best", 0.54, 0.585),
      candidate("runner-up", 0.4, 0.4),
    ]);

    expect(decision).toMatchObject({
      accepted: false,
      reason: "below_similarity_threshold",
    });
  });

  it("fails closed for legacy candidates that do not contain a raw score", () => {
    const decision = evaluatePersonMatchCandidates([
      { assetPersonId: "legacy-best", similarity: 0.59 },
      { assetPersonId: "legacy-runner", similarity: 0.5 },
    ]);

    expect(decision).toMatchObject({
      accepted: false,
      reason: "below_similarity_threshold",
    });
  });

  it("fails closed when a serialized face is marked non-confident", () => {
    const best = match({
      assetPersonId: "best",
      rawSimilarity: 0.7,
      tagId: 1,
      detectionIndex: 0,
    });

    expect(isAcceptedPersonFace(face({ best, noConfidentMatch: true }))).toBe(false);
  });
});

describe("accepted person recommendation tags", () => {
  it("keeps only tags from accepted faces in a mixed multi-face result", () => {
    const acceptedBest = match({
      assetPersonId: "accepted",
      rawSimilarity: 0.68,
      tagId: 101,
      detectionIndex: 0,
    });
    const acceptedRunner = match({
      assetPersonId: "accepted-runner",
      rawSimilarity: 0.5,
      tagId: 102,
      detectionIndex: 0,
    });
    const ambiguousBest = match({
      assetPersonId: "ambiguous",
      rawSimilarity: 0.66,
      tagId: 201,
      detectionIndex: 1,
    });
    const ambiguousRunner = match({
      assetPersonId: "lookalike",
      rawSimilarity: 0.64,
      tagId: 202,
      detectionIndex: 1,
    });

    const recommendation = {
      noConfidentMatch: false,
      faceCount: 2,
      faces: [
        face({
          best: acceptedBest,
          runners: [acceptedRunner],
          noConfidentMatch: false,
        }),
        face({
          best: ambiguousBest,
          runners: [ambiguousRunner],
          // Simulate a stale payload produced by the former >= 0.55 shortcut.
          noConfidentMatch: false,
        }),
      ],
      // Simulate the former unsafe aggregate list. Consumers must ignore it.
      recommendedTags: [...acceptedBest.recommendedTags, ...ambiguousBest.recommendedTags],
    } satisfies TaggingPersonRecommendation;

    expect(getAcceptedPersonRecommendationTagIds(recommendation)).toEqual([101]);
  });

  it("deduplicates a shared tag emitted by multiple accepted faces", () => {
    const first = match({
      assetPersonId: "first",
      rawSimilarity: 0.7,
      tagId: 301,
      detectionIndex: 0,
    });
    const second = match({
      assetPersonId: "second",
      rawSimilarity: 0.72,
      tagId: 301,
      detectionIndex: 1,
    });
    const recommendation = {
      noConfidentMatch: false,
      faceCount: 2,
      faces: [
        face({ best: first, noConfidentMatch: false }),
        face({ best: second, noConfidentMatch: false }),
      ],
      recommendedTags: [...first.recommendedTags, ...second.recommendedTags],
    } satisfies TaggingPersonRecommendation;

    expect(getAcceptedPersonRecommendationTagIds(recommendation)).toEqual([301]);
  });

  it("binds identifiers only for accepted person faces", () => {
    const accepted = match({
      assetPersonId: "accepted-id",
      rawSimilarity: 0.7,
      tagId: 401,
      detectionIndex: 0,
    });
    const ambiguous = match({
      assetPersonId: "ambiguous-id",
      rawSimilarity: 0.65,
      tagId: 402,
      detectionIndex: 1,
    });
    const lookalike = match({
      assetPersonId: "lookalike-id",
      rawSimilarity: 0.63,
      tagId: 403,
      detectionIndex: 1,
    });
    const recommendation = {
      noConfidentMatch: false,
      faceCount: 2,
      faces: [
        face({ best: accepted, noConfidentMatch: false }),
        face({
          best: ambiguous,
          runners: [lookalike],
          noConfidentMatch: false,
        }),
      ],
      recommendedTags: [...accepted.recommendedTags, ...ambiguous.recommendedTags],
    } satisfies TaggingPersonRecommendation;

    expect(
      collectMuseFeatureIdentifierIdsForQueueItem({
        brandRecommendation: null,
        ipRecommendation: null,
        productRecommendation: null,
        personRecommendation: recommendation,
        brandTagIds: [],
        ipTagIds: [],
        productTagIds: [],
        personTagIds: [401, 402],
      }),
    ).toEqual(["accepted-id"]);
  });
});
