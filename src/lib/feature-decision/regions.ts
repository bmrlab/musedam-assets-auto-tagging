import { groupProductDetectionBoxes } from "@/lib/product/detection-box-groups";
import type {
  ClassificationDetectionBox,
  ClassificationImageMeta,
} from "@/lib/tagging/classification-image";

export type DecisionFeatureType = "logo" | "ip" | "product";
export const MAX_FEATURE_REGIONS = 5;
export const MAX_CANDIDATES_PER_REGION = 3;
export const MAX_FEATURE_REFERENCES = MAX_FEATURE_REGIONS * MAX_CANDIDATES_PER_REGION;
const TYPE_ORDER: DecisionFeatureType[] = ["logo", "product", "ip"];

export type RetrievalRegion = {
  featureType: DecisionFeatureType;
  box: ClassificationDetectionBox;
  detectionIndex: number;
  sourceDetectionIndices: number[];
  fallback: boolean;
};

function iou(a: ClassificationDetectionBox, b: ClassificationDetectionBox) {
  const intersection =
    Math.max(0, Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin)) *
    Math.max(0, Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin));
  const area = (a.xMax - a.xMin) * (a.yMax - a.yMin) + (b.xMax - b.xMin) * (b.yMax - b.yMin);
  return intersection / (area - intersection);
}

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
  const selected: RetrievalRegion[] = [];
  // Round-robin guarantees coverage of every enabled type; subsequent slots prefer spatial novelty.
  while (selected.length < MAX_FEATURE_REGIONS && [...pools.values()].some((pool) => pool.length)) {
    for (const featureType of TYPE_ORDER) {
      if (selected.length >= MAX_FEATURE_REGIONS) break;
      const pool = pools.get(featureType);
      if (!pool?.length) continue;
      const previous = selected.filter((region) => region.featureType === featureType);
      const rank = (region: RetrievalRegion) =>
        region.box.score +
        (previous.length
          ? (1 - Math.max(...previous.map((other) => iou(region.box, other.box)))) * 0.2
          : 0);
      pool.sort((a, b) => rank(b) - rank(a) || a.detectionIndex - b.detectionIndex);
      selected.push(pool.shift()!);
    }
  }
  return {
    selected,
    regionsDetected,
    regionsSelected: selected.length,
    regionsOmitted: [...pools.values()].reduce((sum, pool) => sum + pool.length, 0),
    regionsDeduplicated,
  };
}
