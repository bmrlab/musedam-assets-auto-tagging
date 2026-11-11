import type { MetadataSuggestion } from "./MetadataReviewSuggestions";

export async function applyMetadataReviewSelection(
  rows: Pick<MetadataSuggestion, "id" | "status">[],
  excludedIds: number[],
  review: (ids: number[], action: "approve" | "reject") => Promise<unknown>,
) {
  const excluded = new Set(excludedIds);
  const pending = rows.filter((row) => row.status === "pending");
  for (const action of ["reject", "approve"] as const) {
    const ids = pending
      .filter((row) => excluded.has(row.id) === (action === "reject"))
      .map((row) => row.id);
    for (let start = 0; start < ids.length; start += 100)
      await review(ids.slice(start, start + 100), action);
  }
}
