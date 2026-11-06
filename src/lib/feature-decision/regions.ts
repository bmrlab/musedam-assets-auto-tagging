import { groupProductDetectionBoxes } from "@/lib/product/detection-box-groups";
import type {
  ClassificationDetectionBox,
  ClassificationImageMeta,
} from "@/lib/tagging/classification-image";

export type DecisionFeatureType = "logo" | "ip" | "product";
export const MAX_CANDIDATES_PER_REGION = 3;
/** Per decision request, not a cap on the whole asset. */
export const MAX_FEATURE_REFERENCES = 5;
const TYPE_ORDER: DecisionFeatureType[] = ["logo", "product", "ip"];

export type RetrievalRegion = {
  featureType: DecisionFeatureType;
  box: ClassificationDetectionBox;
  detectionIndex: number;
  sourceDetectionIndices: number[];
  fallback: boolean;
};

/** Deduplicate within each task only; a logo inside a product remains a separate region. */
export function selectFeatureRegions(
  boxesByType: Partial<Record<DecisionFeatureType, ClassificationDetectionBox[]>>,
  meta: ClassificationImageMeta,
) {
  const pools = new Map<DecisionFeatureType, RetrievalRegion[]>();
  let regionsDetected = 0;
  let regionsDeduplicated = 0;
  for (const featureType of TYPE_ORDER) {
    const raw = boxesByType[featureType];
    if (!raw) continue;
    regionsDetected += raw.length;
    const bounded = raw.map((box) => ({
      ...box,
      xMin: Math.max(0, Math.min(meta.width, box.xMin)),
      xMax: Math.max(0, Math.min(meta.width, box.xMax)),
      yMin: Math.max(0, Math.min(meta.height, box.yMin)),
      yMax: Math.max(0, Math.min(meta.height, box.yMax)),
    }));
    // The product grouping policy also prevents merging adjacent or nested distinct objects.
    const groups = groupProductDetectionBoxes(bounded);
    regionsDeduplicated += raw.length - groups.length;
    const regions: RetrievalRegion[] = groups.map((group) => ({
      ...group,
      featureType,
      fallback: false,
    }));
    if (regions.length === 0)
      regions.push({
        featureType,
        box: {
          xMin: 0,
          yMin: 0,
          xMax: meta.width,
          yMax: meta.height,
          score: 0,
          label: "whole image fallback",
        },
        detectionIndex: 0,
        sourceDetectionIndices: [],
        fallback: true,
      });
    pools.set(featureType, regions);
  }
  // Independent pools retain every distinct object; concurrency/batches bound work downstream.
  const selected = [...pools.values()].flatMap((pool) =>
    pool.sort((a, b) => b.box.score - a.box.score || a.detectionIndex - b.detectionIndex),
  );
  return {
    selected,
    regionsDetected,
    regionsSelected: selected.length,
    regionsOmitted: 0,
    regionsDeduplicated,
  };
}
