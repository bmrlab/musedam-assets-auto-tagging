import "server-only";

import { llm, LLMModelName } from "@/ai/provider";
import {
  isDetectionLabelWithinTokenLimit,
  truncateDetectionLabelToTokenLimit,
} from "@/lib/detection-label";
import { translateDetectionLabelText } from "@/lib/translation/service";
import { normalizeDetectionText } from "@/lib/utils";
import { generateObject } from "ai";
import { z } from "zod";

const summarizedProductCategoriesSchema = z.object({
  categories: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
});

type ProductDetectionPromptSource = {
  name: string;
  generalCategory: string;
};

type ProductDetectionPromptDependencies = {
  translate?: (labelText: string) => Promise<string>;
  summarize?: (categories: string[]) => Promise<string[]>;
};

export function normalizeProductDetectionPromptTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[。！!？?]/g, " ")
    .trim();
}

function uniquePromptTerms(values: string[]) {
  return Array.from(new Set(values.map(normalizeProductDetectionPromptTerm).filter(Boolean)));
}

function composeDetectionLabelText(terms: string[]) {
  return terms.length > 0 ? terms.join(" . ") : "product";
}

function splitDetectionLabelText(labelText: string) {
  return labelText
    .split(/\s*\.\s*/)
    .map(normalizeProductDetectionPromptTerm)
    .filter(Boolean);
}

function getProductCategorySummaryModel(): LLMModelName {
  return (process.env.PRODUCT_CATEGORY_PREDICT_MODEL?.trim() || "gpt-5-mini") as LLMModelName;
}

async function summarizeProductCategories(categories: string[]) {
  const result = await generateObject({
    model: llm(getProductCategorySummaryModel()),
    schemaName: "ProductDetectionCategories",
    schemaDescription:
      'Return JSON with one "categories" array containing concise English product categories.',
    schema: summarizedProductCategoriesSchema,
    prompt: `Condense this product category list for an object detector:
${categories.join(" . ")}

Rules:
- Merge duplicates, synonyms, and overly specific categories into broader visual categories.
- Preserve coverage of the original list.
- Use only short, lowercase English common nouns or noun phrases.
- Do not include product names, brands, model names, explanations, or punctuation.
- Return at most 20 categories and keep their combined text under 180 characters.`,
    maxOutputTokens: 256,
    temperature: 0,
  });

  return uniquePromptTerms(result.object.categories);
}

async function translateAndNormalize(
  terms: string[],
  translate: (labelText: string) => Promise<string>,
) {
  return normalizeDetectionText(await translate(composeDetectionLabelText(terms)));
}

/**
 * Prefer product names plus categories, then categories alone, then an LLM-condensed
 * category list. A hard truncation is applied only as the final fallback.
 */
export async function buildProductDetectionLabelText(
  products: ProductDetectionPromptSource[],
  dependencies: ProductDetectionPromptDependencies = {},
) {
  const translate = dependencies.translate ?? translateDetectionLabelText;
  const summarize = dependencies.summarize ?? summarizeProductCategories;
  const productAndCategoryTerms = uniquePromptTerms(
    products.flatMap((product) => [product.name, product.generalCategory]),
  );

  const detailedLabelText = await translateAndNormalize(productAndCategoryTerms, translate);
  if (isDetectionLabelWithinTokenLimit(detailedLabelText)) {
    return detailedLabelText;
  }

  const categoryTerms = uniquePromptTerms(products.map((product) => product.generalCategory));
  let categoryLabelText = await translateAndNormalize(categoryTerms, translate);
  if (isDetectionLabelWithinTokenLimit(categoryLabelText)) {
    return categoryLabelText;
  }

  try {
    const summarizedTerms = await summarize(splitDetectionLabelText(categoryLabelText));
    if (summarizedTerms.length > 0) {
      categoryLabelText = await translateAndNormalize(summarizedTerms, translate);
    }
  } catch (error) {
    console.warn("Failed to summarize product detection categories:", error);
  }

  return truncateDetectionLabelToTokenLimit(categoryLabelText);
}
