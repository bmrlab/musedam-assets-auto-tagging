/**
 * The vector query floor is intentionally lower than the automatic-acceptance
 * threshold. Weak candidates are still useful for runner-up comparisons and
 * review diagnostics, but must never become automatic tags by themselves.
 */
export const PERSON_VECTOR_CANDIDATE_SCORE_FLOOR = 0.25;

/** Precision-first defaults for direct tagging against large person galleries. */
export const PERSON_AUTO_TAG_MIN_RAW_SIMILARITY = 0.55;
export const PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN = 0.06;

// Older persisted recommendations only contain the support-adjusted similarity.
// Subtract the largest possible historical bonus so legacy results fail closed.
const PERSON_LEGACY_MAX_SUPPORT_BONUS = 0.045;

export type PersonMatchPolicyCandidate = {
  assetPersonId?: string | null;
  similarity: number;
  rawSimilarity?: number | null;
};

export type PersonMatchPolicyFace = {
  bestMatch: PersonMatchPolicyCandidate | null;
  topMatches: PersonMatchPolicyCandidate[];
  noConfidentMatch: boolean;
};

export type PersonMatchDecisionReason =
  | "no_candidate"
  | "below_similarity_threshold"
  | "ambiguous_runner_up"
  | "accepted";

export type PersonMatchDecision = {
  accepted: boolean;
  reason: PersonMatchDecisionReason;
  bestRawSimilarity: number | null;
  runnerUpRawSimilarity: number | null;
  margin: number | null;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getPersonCandidateRawSimilarity(candidate: PersonMatchPolicyCandidate): number {
  if (finiteNumber(candidate.rawSimilarity)) {
    return candidate.rawSimilarity;
  }

  if (finiteNumber(candidate.similarity)) {
    return candidate.similarity - PERSON_LEGACY_MAX_SUPPORT_BONUS;
  }

  return Number.NEGATIVE_INFINITY;
}

export function evaluatePersonMatchCandidates(
  candidates: PersonMatchPolicyCandidate[],
): PersonMatchDecision {
  const best = candidates[0];
  if (!best) {
    return {
      accepted: false,
      reason: "no_candidate",
      bestRawSimilarity: null,
      runnerUpRawSimilarity: null,
      margin: null,
    };
  }

  const bestRawSimilarity = getPersonCandidateRawSimilarity(best);
  if (!Number.isFinite(bestRawSimilarity)) {
    return {
      accepted: false,
      reason: "no_candidate",
      bestRawSimilarity: null,
      runnerUpRawSimilarity: null,
      margin: null,
    };
  }

  const runnerUpScores = candidates
    .slice(1)
    .map(getPersonCandidateRawSimilarity)
    .filter(Number.isFinite);
  const runnerUpRawSimilarity = runnerUpScores.length > 0 ? Math.max(...runnerUpScores) : null;
  const margin = bestRawSimilarity - (runnerUpRawSimilarity ?? 0);

  if (bestRawSimilarity < PERSON_AUTO_TAG_MIN_RAW_SIMILARITY) {
    return {
      accepted: false,
      reason: "below_similarity_threshold",
      bestRawSimilarity,
      runnerUpRawSimilarity,
      margin,
    };
  }

  if (runnerUpRawSimilarity !== null && margin < PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN) {
    return {
      accepted: false,
      reason: "ambiguous_runner_up",
      bestRawSimilarity,
      runnerUpRawSimilarity,
      margin,
    };
  }

  return {
    accepted: true,
    reason: "accepted",
    bestRawSimilarity,
    runnerUpRawSimilarity,
    margin,
  };
}

/**
 * Re-evaluate serialized face results instead of trusting a top-level tag list.
 * Requiring noConfidentMatch === false makes missing or malformed legacy data
 * fail closed.
 */
export function isAcceptedPersonFace(face: PersonMatchPolicyFace): boolean {
  if (face.noConfidentMatch !== false || !face.bestMatch || !Array.isArray(face.topMatches)) {
    return false;
  }

  const rankedBest = face.topMatches[0];
  if (!rankedBest) {
    return false;
  }

  if (
    face.bestMatch.assetPersonId &&
    rankedBest.assetPersonId &&
    face.bestMatch.assetPersonId !== rankedBest.assetPersonId
  ) {
    return false;
  }

  return evaluatePersonMatchCandidates(face.topMatches).accepted;
}
