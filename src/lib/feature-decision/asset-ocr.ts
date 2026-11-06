import { boundOcrSegments } from "./prompts";

/** Reuse only explicit OCR fields; generated captions/descriptions are not transcriptions. */
export function getAssetOcrSegments(extra: unknown, content?: unknown): string[] {
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") return value.trim() ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(strings);
    return [];
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (typeof value === "string" && value.length < 1_000_000) {
      try {
        value = JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  };
  const asset = object(extra),
    analysis = object(asset.imageContentAnalysis),
    saved = object(content);
  return boundOcrSegments(
    [asset.ocrContent, analysis.aiOcr, saved.aiOcr, saved.ocrContent].flatMap(strings),
  );
}
