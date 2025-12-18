import { type Locale } from "@/i18n/routing";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * Chat completion response model
 */
interface Message {
  content: string;
  role: string;
  provider_specific_fields?: Record<string, unknown>;
}

interface Choice {
  finish_reason: string;
  index: number;
  message: Message;
  provider_specific_fields?: Record<string, unknown>;
}

interface Usage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
}

interface ChatCompletionResponse {
  choices: Choice[];
  created: number;
  id: string;
  model: string;
  object: string;
  usage: Usage;
}

// Map locale codes to language names for the translation API
const localeToLanguageName: Record<Locale, string> = {
  "zh-CN": "Chinese",
  "en-US": "English",
  "zh-TW": "Traditional Chinese",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "pt-BR": "Portuguese",
  "ru-RU": "Russian",
  "id-ID": "Indonesian",
  "fr-FR": "French",
  "it-IT": "Italian",
  "pl-PL": "Polish",
  "vi-VN": "Vietnamese",
  "tr-TR": "Turkish",
  "th-TH": "Thai",
  "de-DE": "German",
  "es-ES": "Spanish",
  "hi-IN": "Hindi",
};

/**
 * Convert locale code to language name
 */
function convertLangCodeToName(locale: Locale): string {
  return localeToLanguageName[locale];
}

/**
 * Service function to call translation API
 */
async function serviceTextTranslate({
  content,
  targetLangName,
  token,
}: {
  content: string;
  targetLangName: string;
  token: string;
}): Promise<string> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const response = await fetch("https://cloudnative.tezign.com/litellm/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "qwen-mt-flash",
      messages: [
        {
          role: "user",
          content,
        },
      ],
      translation_options: {
        source_lang: "auto",
        target_lang: targetLangName,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Translation API error: ${response.status}`);
  }
  const data = (await response.json()) as ChatCompletionResponse;
  let translatedText = content;
  if (data.choices?.[0]?.message?.content) {
    translatedText = data.choices[0].message.content;
  }
  return translatedText;
}

/**
 * Batch translate multiple texts using a single API call
 */
async function translateBatch(
  texts: string[],
  targetLocale: Locale,
  token: string,
): Promise<string[]> {
  const targetLangName = convertLangCodeToName(targetLocale);
  const debugPrint = false;

  if (texts.length === 0) {
    return [];
  }

  const separator = "<======>";

  try {
    // Join all texts with separator, adding separator before each text (including the first)
    const combinedText = texts.map((text) => `\n${separator}\n${text}`).join("");

    if (debugPrint) console.log("batch input = ", combinedText);
    // Translate the combined text in a single API call
    const response = await serviceTextTranslate({
      content: combinedText,
      targetLangName,
      token,
    });
    if (debugPrint) console.log("batch output = ", response);

    // Handle response - extract the translated text
    let translatedText: string;
    if (typeof response === "string") {
      translatedText = response;
    } else if (response && typeof response === "object") {
      // If response is an object, try to extract translated text
      const responseObj = response as Record<string, unknown>;
      translatedText =
        (typeof responseObj.translatedText === "string" ? responseObj.translatedText : null) ||
        (typeof responseObj.content === "string" ? responseObj.content : null) ||
        (typeof responseObj.result === "string" ? responseObj.result : null) ||
        combinedText;
    } else {
      // If response is boolean or unexpected type, return original text
      translatedText = combinedText;
    }

    // Find the first occurrence of the separator pattern - this marks where the actual translation starts
    const separatorPattern = `${separator}\n`;
    const firstSeparatorIndex = translatedText.indexOf(separatorPattern);
    if (firstSeparatorIndex !== -1) {
      // Extract everything from the first separator (the separator itself will be part of the split)
      translatedText = translatedText.substring(firstSeparatorIndex);
    } else {
      // Fallback: try to find just the separator without newlines
      const simpleSeparatorIndex = translatedText.indexOf(separator);
      if (simpleSeparatorIndex !== -1) {
        // Find the newline before the separator
        const beforeSeparatorIndex = translatedText.lastIndexOf("\n", simpleSeparatorIndex);
        if (beforeSeparatorIndex !== -1) {
          translatedText = translatedText.substring(beforeSeparatorIndex + 1);
        } else {
          translatedText = translatedText.substring(simpleSeparatorIndex);
        }
      }
    }

    // Split the translated text back into array using the separator
    // Filter out empty strings that may result from leading separator
    const translations = translatedText
      .split(separatorPattern)
      .filter((text) => text.trim() !== "");

    // Ensure we return the same number of translations as input texts
    // If split results in fewer items, pad with original texts
    if (translations.length !== texts.length) {
      console.warn(
        `Translation count mismatch: expected ${texts.length}, got ${translations.length}. Padding with original texts.`,
      );
      while (translations.length < texts.length) {
        translations.push(texts[translations.length] || "failed");
      }
      // If we got more translations than expected, trim to match
      if (translations.length > texts.length) {
        translations.splice(texts.length);
      }
    }

    return translations;
  } catch (error) {
    console.error("Batch translation error:", error);
    // Fallback: return failed for all texts if batch fails
    return texts.map(() => "failed");
  }
}

const requestSchema = z.object({
  texts: z.array(z.string()),
  targetLocale: z.enum([
    "zh-CN",
    "en-US",
    "zh-TW",
    "ja-JP",
    "ko-KR",
    "pt-BR",
    "ru-RU",
    "id-ID",
    "fr-FR",
    "it-IT",
    "pl-PL",
    "vi-VN",
    "tr-TR",
    "th-TH",
    "de-DE",
    "es-ES",
    "hi-IN",
  ]),
});

export async function POST(request: NextRequest) {
  try {
    // Check if token is configured
    const token = process.env.LIVE_TRANSLATION_TOKEN;
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: "Translation service is not configured",
        },
        { status: 503 },
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const { texts, targetLocale } = requestSchema.parse(body);

    // Translate the texts
    const translations = await translateBatch(texts, targetLocale as Locale, token);

    return NextResponse.json({
      success: true,
      data: translations,
    });
  } catch (error) {
    console.error("Translation API request failed:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request format",
          details: error.issues,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
