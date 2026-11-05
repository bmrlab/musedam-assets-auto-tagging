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
  { id: 1, name: "精华液主视觉.jpg", status: "pending", prediction, available: true },
  {
    id: 2,
    name: "已停用字段示例.jpg",
    status: "pending",
    prediction: { ...prediction, fieldName: "已停用字段" },
    available: false,
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
