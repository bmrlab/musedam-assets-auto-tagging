import { normalizeDetectionText } from "@/lib/utils";

export const DETECTION_LABEL_TOKEN_LIMIT = 256;

const DETECTION_LABEL_SPECIAL_TOKEN_COUNT = 2;
const NORMALIZED_DETECTION_LABEL_SUFFIX_TOKEN_COUNT = 1;

function countNonWhitespaceCodePoints(text: string) {
  return Array.from(text).filter((character) => !/\s/u.test(character)).length;
}

/**
 * Return a safe upper bound for the detector's WordPiece-style token count.
 *
 * A text token cannot contain less than one non-whitespace Unicode code point,
 * so counting each such code point as a token is deliberately conservative.
 * The detector also adds start/end special tokens.
 */
export function getDetectionLabelTokenUpperBound(text: string) {
  return countNonWhitespaceCodePoints(text) + DETECTION_LABEL_SPECIAL_TOKEN_COUNT;
}

export function isDetectionLabelWithinTokenLimit(text: string) {
  return getDetectionLabelTokenUpperBound(text) <= DETECTION_LABEL_TOKEN_LIMIT;
}

/** Final safeguard for every Grounding DINO request. */
export function truncateDetectionLabelToTokenLimit(text: string) {
  const normalizedText = normalizeDetectionText(text);
  if (!normalizedText || isDetectionLabelWithinTokenLimit(normalizedText)) {
    return normalizedText;
  }

  const suffix = " .";
  const contentTokenBudget =
    DETECTION_LABEL_TOKEN_LIMIT -
    DETECTION_LABEL_SPECIAL_TOKEN_COUNT -
    NORMALIZED_DETECTION_LABEL_SUFFIX_TOKEN_COUNT;
  let remainingTokens = contentTokenBudget;
  let truncatedText = "";

  for (const character of Array.from(normalizedText.slice(0, -suffix.length))) {
    if (!/\s/u.test(character)) {
      if (remainingTokens === 0) {
        break;
      }
      remainingTokens -= 1;
    }
    truncatedText += character;
  }

  return normalizeDetectionText(truncatedText);
}
