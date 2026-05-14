import "server-only";

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

/** Each unique term is translated via `translateTextToEnglish` for Grounding DINO labels. */
export async function translateDetectionTermsToEnglish(orderedTerms: string[]): Promise<string[]> {
  const keys = orderedTerms.map((term) => term.trim()).filter(Boolean);
  if (keys.length === 0) {
    return [];
  }

  const unique = [...new Set(keys)];
  const translatedByTerm = new Map<string, string>();

  await Promise.all(
    unique.map(async (term) => {
      try {
        const translated = (await translateTextToEnglish(term)).trim();
        translatedByTerm.set(term, translated || term);
      } catch (error) {
        console.error("translateDetectionTermsToEnglish failed for term:", term, error);
        translatedByTerm.set(term, term);
      }
    }),
  );

  return keys.map((term) => translatedByTerm.get(term) ?? term);
}
