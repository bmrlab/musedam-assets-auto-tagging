export const prediction = {
  fieldId: "f",
  expectedFieldVersion: 2,
  fieldName: "适用产品线",
  optionIds: ["a"],
  labels: ["精华"],
  confidence: 0.92,
  score: 92,
  effective: true,
  sources: [{ source: "basicInfo" as const, confidence: 0.9, evidence: "精华液主视觉" }],
};
let rows = [
  {
    id: 1,
    assetObjectId: 1,
    name: "产品发布会海报",
    status: "pending",
    prediction: { ...prediction, fieldName: "投放渠道", labels: ["天猫", "小红书"] },
    available: true,
  },
  {
    id: 3,
    assetObjectId: 1,
    name: "产品发布会海报",
    status: "pending",
    prediction: {
      ...prediction,
      fieldId: "spec",
      fieldName: "素材规格",
      labels: ["1920×1080 横版"],
      score: 76,
    },
    available: true,
  },
  {
    id: 2,
    assetObjectId: 2,
    name: "运动鞋户外摄影",
    status: "pending",
    prediction: { ...prediction, fieldName: "素材用途", labels: ["种草笔记"] },
    available: true,
  },
  {
    id: 4,
    assetObjectId: 2,
    name: "运动鞋户外摄影",
    status: "pending",
    prediction: {
      ...prediction,
      fieldId: "channel",
      fieldName: "投放渠道",
      labels: ["小红书"],
      score: 50,
      effective: false,
    },
    available: true,
  },
];
export async function fetchMetadataReviews(_page = 1, status = "pending") {
  return {
    rows: rows.filter((row) => row.status === status),
    total: rows.filter((row) => row.status === status).length,
  };
}
export async function reviewMetadata(ids: number[], action: string) {
  rows = rows.map((row) =>
    ids.includes(row.id) ? { ...row, status: action === "approve" ? "approved" : "rejected" } : row,
  );
  return { applied: ids.length, skipped: 0 };
}
export async function getTeamHasTags() {
  return { success: true, data: { hasTags: true } };
}
export async function fetchDashboardStats() {
  return { success: true, data: { queue: { pending: 0, processing: 0 } } };
}
export async function dispatchMuseDAMClientAction() {
  return null;
}

export async function fetchReviewMetadataValues(assetObjectId?: number) {
  return assetObjectId === 2 ? {} : { 素材用途: "主视觉" };
}

// UI fixture only: uses the production review components without contacting a database.
export async function fetchMetadataReviewAssets(
  page = 1,
  pageSize = 40,
  filters = { status: "pending", source: "all", confidence: "all", time: "all", search: "" },
) {
  const matches = rows.filter(
    (row) =>
      (filters.status === "all" || row.status === filters.status) &&
      (!filters.search || row.name.includes(filters.search)) &&
      (filters.source === "all" ||
        row.prediction.sources.some((s) => s.source === filters.source)) &&
      (filters.confidence === "all" ||
        (filters.confidence === "high"
          ? row.prediction.score >= 80
          : filters.confidence === "medium"
            ? row.prediction.score >= 60 && row.prediction.score < 80
            : row.prediction.score < 60)),
  );
  const ids = [...new Set(matches.map((row) => row.assetObjectId))];
  return {
    total: ids.length,
    assets: ids.slice((page - 1) * pageSize, page * pageSize).map((id) => ({
      assetObject: {
        id,
        slug: `a/${id}`,
        name: matches.find((row) => row.assetObjectId === id)!.name,
        extra: {
          extension: "jpg",
          size: 2621440,
          thumbnailAccessUrl:
            id === 1
              ? new URL("./poster.svg", import.meta.url).href
              : new URL("./outdoor.svg", import.meta.url).href,
        },
      },
      createdAt: new Date("2025-07-30T10:30:00+08:00"),
      rows: matches.filter((row) => row.assetObjectId === id),
    })),
  };
}
