export interface ProductDetectionBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
}

export interface ProductDetectionBoxGroup {
  /** An actual detector box, chosen by geometric agreement with the group. */
  box: ProductDetectionBox;
  /** Zero-based index of the representative in the original detections array. */
  detectionIndex: number;
  /** Zero-based original indices, including the representative. */
  sourceDetectionIndices: number[];
}

const DUPLICATE_IOU = 0.7;
const DUPLICATE_CONTAINMENT = 0.9;
// Containment alone also matches a cap inside a bottle or a box around two
// products. Require similar dimensions and aligned centers before using it.
const MIN_CONTAINED_AREA_RATIO = 0.6;
const MIN_CONTAINED_SIDE_RATIO = 0.75;
const MAX_CONTAINED_CENTER_OFFSET = 0.1;
const COMPARISON_EPSILON = 1e-9;

interface IndexedBox {
  box: ProductDetectionBox;
  detectionIndex: number;
  width: number;
  height: number;
  area: number;
}

function measureBox(box: ProductDetectionBox, detectionIndex: number): IndexedBox | null {
  if (![box.xMin, box.yMin, box.xMax, box.yMax, box.score].every(Number.isFinite)) {
    return null;
  }
  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  const area = width * height;
  if (width <= 0 || height <= 0 || !Number.isFinite(area) || area <= 0) {
    return null;
  }
  return { box, detectionIndex, width, height, area };
}

function overlap(a: IndexedBox, b: IndexedBox) {
  const intersectionWidth = Math.max(
    0,
    Math.min(a.box.xMax, b.box.xMax) - Math.max(a.box.xMin, b.box.xMin),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(a.box.yMax, b.box.yMax) - Math.max(a.box.yMin, b.box.yMin),
  );
  const intersection = intersectionWidth * intersectionHeight;
  return {
    iou: intersection / (a.area + b.area - intersection),
    containment: intersection / Math.min(a.area, b.area),
  };
}

function areDuplicates(a: IndexedBox, b: IndexedBox): boolean {
  const { iou, containment } = overlap(a, b);
  if (iou >= DUPLICATE_IOU) return true;
  if (containment < DUPLICATE_CONTAINMENT) return false;

  const centerOffsetX = Math.abs(a.box.xMin + a.width / 2 - (b.box.xMin + b.width / 2));
  const centerOffsetY = Math.abs(a.box.yMin + a.height / 2 - (b.box.yMin + b.height / 2));
  return (
    Math.min(a.area, b.area) / Math.max(a.area, b.area) >= MIN_CONTAINED_AREA_RATIO &&
    Math.min(a.width, b.width) / Math.max(a.width, b.width) >= MIN_CONTAINED_SIDE_RATIO &&
    Math.min(a.height, b.height) / Math.max(a.height, b.height) >= MIN_CONTAINED_SIDE_RATIO &&
    centerOffsetX / Math.max(a.width, b.width) <= MAX_CONTAINED_CENTER_OFFSET &&
    centerOffsetY / Math.max(a.height, b.height) <= MAX_CONTAINED_CENTER_OFFSET
  );
}

function selectRepresentative(members: IndexedBox[]): IndexedBox {
  let representative = members[0];
  let bestAgreement = -1;
  for (const candidate of members) {
    const agreement = members.reduce((sum, member) => sum + overlap(candidate, member).iou, 0);
    const tied = Math.abs(agreement - bestAgreement) <= COMPARISON_EPSILON;
    if (
      agreement > bestAgreement + COMPARISON_EPSILON ||
      (tied &&
        (candidate.box.score > representative.box.score ||
          (candidate.box.score === representative.box.score &&
            candidate.detectionIndex < representative.detectionIndex)))
    ) {
      representative = candidate;
      bestAgreement = agreement;
    }
  }
  return representative;
}

/**
 * Consolidate repeated detections of a physical product before cropping.
 * Labels do not participate: e.g. "bottle" and "lotion" can describe the
 * same object. Every member must be compatible with every other member, so
 * a chain of overlapping boxes cannot join two separate products together.
 *
 * Processing order and tie-breaks are stable. A geometry medoid is retained
 * instead of a union box, which could include neighboring products.
 */
export function groupProductDetectionBoxes(
  boxes: ProductDetectionBox[],
): ProductDetectionBoxGroup[] {
  const groups: IndexedBox[][] = [];
  for (const [detectionIndex, box] of boxes.entries()) {
    const candidate = measureBox(box, detectionIndex);
    if (!candidate) continue;

    let bestGroup: IndexedBox[] | undefined;
    let bestAgreement = -1;
    for (const group of groups) {
      if (!group.every((member) => areDuplicates(candidate, member))) continue;
      const agreement =
        group.reduce((sum, member) => sum + overlap(candidate, member).iou, 0) / group.length;
      if (agreement > bestAgreement + COMPARISON_EPSILON) {
        bestGroup = group;
        bestAgreement = agreement;
      }
    }
    if (bestGroup) bestGroup.push(candidate);
    else groups.push([candidate]);
  }

  return groups
    .map((members) => {
      const representative = selectRepresentative(members);
      return {
        box: representative.box,
        detectionIndex: representative.detectionIndex,
        sourceDetectionIndices: members
          .map((member) => member.detectionIndex)
          .sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.detectionIndex - b.detectionIndex);
}
