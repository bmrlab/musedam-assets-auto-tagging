import type { TaggingSettingsData } from "@/app/(tagging)/types";
import { calculateMultiSourceScore } from "@/lib/tagging/source-score";
import type { MetadataContext, MetadataPrediction, MetadataSource } from "./types";
export interface RawMetadataPrediction {
  fieldId: string;
  optionIds: string[];
  checked?: boolean | null;
  source: MetadataSource;
  confidence: number;
  evidence: string;
}
/** Closed-world validation: source evidence must be a verbatim excerpt, IDs must belong to this field. */
export function resolveMetadataPredictions(
  context: MetadataContext,
  raw: RawMetadataPrediction[],
  texts: Partial<Record<MetadataSource, string>>,
  settings: Pick<TaggingSettingsData, "recognitionAccuracy" | "sourceWeights">,
): MetadataPrediction[] {
  const threshold = { precise: 80, balanced: 60, broad: 40 }[settings.recognitionAccuracy];
  const result: MetadataPrediction[] = [];
  for (const field of context.fields) {
    const candidates = new Map<string, MetadataPrediction>();
    const inputs = raw
      .filter((p) => p.fieldId === field.fieldId)
      .flatMap((p) =>
        field.multiple ? p.optionIds.map((id) => ({ ...p, optionIds: [id] })) : [p],
      );
    for (const prediction of inputs) {
      if (
        !Number.isFinite(prediction.confidence) ||
        prediction.confidence < 0 ||
        prediction.confidence > 1 ||
        !prediction.evidence?.trim() ||
        !texts[prediction.source]?.includes(prediction.evidence)
      )
        continue;
      const ids = [...new Set(prediction.optionIds)];
      if (
        field.type === "boolean"
          ? typeof prediction.checked !== "boolean" || ids.length > 0
          : !ids.length ||
            !ids.every((id) => field.options.some((o) => o.id === id)) ||
            (!field.multiple && ids.length !== 1)
      )
        continue;
      const key = field.type === "boolean" ? String(prediction.checked) : ids.sort().join("|");
      let item = candidates.get(key);
      if (!item) {
        item = {
          fieldId: field.fieldId,
          expectedFieldVersion: field.fieldVersion,
          fieldName: field.name,
          ...(field.type === "boolean" ? { checked: prediction.checked! } : { optionIds: ids }),
          labels:
            field.type === "boolean"
              ? []
              : ids.map((id) => field.options.find((o) => o.id === id)!.label),
          confidence: 0,
          score: 0,
          effective: false,
          sources: [],
        };
        candidates.set(key, item);
      }
      const previous = item.sources.find((s) => s.source === prediction.source);
      if (!previous)
        item.sources.push({
          source: prediction.source,
          confidence: prediction.confidence,
          evidence: prediction.evidence,
        });
      else if (prediction.confidence > previous.confidence) {
        previous.confidence = prediction.confidence;
        previous.evidence = prediction.evidence;
      }
    }
    for (const item of candidates.values()) {
      item.score = Math.round(
        calculateMultiSourceScore(
          Object.fromEntries(item.sources.map((source) => [source.source, source.confidence])),
          settings.sourceWeights,
        ) * 100,
      );
      item.confidence = item.score / 100;
      item.effective = item.score >= threshold;
    }
    // Mutually exclusive values are never automatically combined; retain losing alternatives as candidates.
    const sorted = [...candidates.values()].sort(
      (a, b) =>
        b.score - a.score ||
        JSON.stringify(a.optionIds ?? a.checked).localeCompare(
          JSON.stringify(b.optionIds ?? b.checked),
        ),
    );
    if (field.multiple) {
      const effective = sorted.filter((item) => item.effective);
      if (effective.length)
        result.push({
          ...effective[0],
          optionIds: effective.flatMap((item) => item.optionIds || []),
          labels: effective.flatMap((item) => item.labels),
          score: Math.min(...effective.map((item) => item.score)),
          confidence: Math.min(...effective.map((item) => item.confidence)),
          sources: effective
            .flatMap((item) => item.sources)
            .filter(
              (source, index, all) =>
                all.findIndex(
                  (s) => s.source === source.source && s.evidence === source.evidence,
                ) === index,
            ),
        });
      result.push(...sorted.filter((item) => !item.effective));
    } else
      sorted.forEach((item, index) => {
        if (index > 0) item.effective = false;
        result.push(item);
      });
  }
  return result;
}
