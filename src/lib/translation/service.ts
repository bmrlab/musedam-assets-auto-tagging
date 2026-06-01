import "server-only";

import pLimit from "p-limit";

type TranslationServiceResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
};

const DETECTION_BATCH_SEPARATOR = "<======>";
const DETECTION_BATCH_SEPARATOR_PATTERN = `${DETECTION_BATCH_SEPARATOR}\n`;
const DETECTION_TRANSLATION_CONCURRENCY = 2;

const detectionBatchTranslationLimit = pLimit(DETECTION_TRANSLATION_CONCURRENCY);

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

function getTranslationServiceConfig() {
  return {
    url: getRequiredEnv("TRANSLATION_SERVICE_URL"),
    apiKey: getRequiredEnv("TRANSLATION_SERVICE_API_KEY"),
    model: getRequiredEnv("TRANSLATION_SERVICE_MODEL"),
  };
}

function getTranslationServiceErrorDetail(payload: TranslationServiceResponse | null) {
  return payload?.error?.message || payload?.message || "";
}

export async function translateTextToEnglish(input: string) {
  const text = input.trim();

  if (!text) {
    return "";
  }

  const config = getTranslationServiceConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
      translation_options: {
        source_lang: "auto",
        target_lang: "English",
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as TranslationServiceResponse | null;

  if (!response.ok) {
    const detail = getTranslationServiceErrorDetail(payload);
    throw new Error(
      `Translation service request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const translatedText = payload?.choices?.[0]?.message?.content?.trim();

  if (!translatedText) {
    throw new Error("Translation service response missing translated content");
  }

  return translatedText;
}

function splitDetectionPromptTerms(prompt: string) {
  return prompt
    .split(/\s*\.\s*/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function joinDetectionPromptTerms(terms: string[]) {
  return terms
    .map((term) => term.trim())
    .filter(Boolean)
    .join(" . ");
}

function splitBatchTranslatedText(translatedText: string, expectedCount: number) {
  let normalized = translatedText;

  const separatorPatternIndex = normalized.indexOf(DETECTION_BATCH_SEPARATOR_PATTERN);
  if (separatorPatternIndex !== -1) {
    normalized = normalized.substring(separatorPatternIndex);
  } else {
    const separatorIndex = normalized.indexOf(DETECTION_BATCH_SEPARATOR);
    if (separatorIndex !== -1) {
      const beforeSeparatorIndex = normalized.lastIndexOf("\n", separatorIndex);
      normalized =
        beforeSeparatorIndex !== -1
          ? normalized.substring(beforeSeparatorIndex + 1)
          : normalized.substring(separatorIndex);
    }
  }

  const translations = normalized
    .split(DETECTION_BATCH_SEPARATOR_PATTERN)
    .map((text) => text.trim())
    .filter(Boolean);

  if (translations.length === expectedCount) {
    return translations;
  }

  console.warn(
    `Detection batch translation count mismatch: expected ${expectedCount}, got ${translations.length}`,
  );

  const padded = [...translations];
  while (padded.length < expectedCount) {
    padded.push("");
  }

  return padded.slice(0, expectedCount);
}

async function translateDetectionBatchToEnglish(texts: string[]): Promise<string[]> {
  const combinedText = texts.map((text) => `\n${DETECTION_BATCH_SEPARATOR}\n${text}`).join("");
  const translatedCombined = await translateTextToEnglish(combinedText);
  return splitBatchTranslatedText(translatedCombined, texts.length);
}

async function translateDetectionTermsToEnglish(orderedTerms: string[]): Promise<string[]> {
  const terms = orderedTerms.map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  const uniqueTerms = [...new Set(terms)];

  try {
    const translations = await detectionBatchTranslationLimit(() =>
      translateDetectionBatchToEnglish(uniqueTerms),
    );
    const translatedByTerm = new Map(
      uniqueTerms.map((term, index) => [term, translations[index]?.trim() || term]),
    );

    return terms.map((term) => translatedByTerm.get(term) ?? term);
  } catch (error) {
    console.error("translateDetectionTermsToEnglish batch failed:", error);
    return terms;
  }
}

/** Split a Grounding DINO label prompt, batch-translate once, and rejoin with ` . `. */
export async function translateDetectionLabelText(labelText: string): Promise<string> {
  const terms = splitDetectionPromptTerms(labelText);
  if (terms.length === 0) {
    return "";
  }

  const translatedTerms = await translateDetectionTermsToEnglish(terms);
  return joinDetectionPromptTerms(translatedTerms);
}
