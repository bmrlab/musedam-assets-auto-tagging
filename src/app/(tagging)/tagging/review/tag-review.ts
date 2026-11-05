/** Provenance is recorded only after a review has been applied successfully. */
export type ReviewTagSource = "existing" | "ai" | "manual" | "unknown";
type TagReviewSnapshot = {
  version: 1;
  reviewedAt: string;
  sources: Record<string, Exclude<ReviewTagSource, "unknown">>;
};

export function createTagReviewSnapshot({
  existingTagSlugs,
  appliedTags,
  manualTagIds,
}: {
  existingTagSlugs: string[] | null;
  appliedTags: { id: number; slug: string | null }[];
  manualTagIds: number[];
}): TagReviewSnapshot {
  const sources: TagReviewSnapshot["sources"] = {};
  const manual = new Set(manualTagIds);
  // Without a pre-application snapshot, we cannot prove an applied tag was new.
  if (existingTagSlugs !== null) {
    for (const tag of appliedTags) {
      if (tag.slug) sources[tag.slug] = manual.has(tag.id) ? "manual" : "ai";
    }
    for (const slug of existingTagSlugs) sources[slug] = "existing";
  }
  return { version: 1, reviewedAt: new Date().toISOString(), sources };
}

export function getReviewTagSources(extras: unknown[]): Map<string, ReviewTagSource> {
  const snapshots: TagReviewSnapshot[] = [];
  for (const extra of extras) {
    if (!extra || typeof extra !== "object" || !("tagReview" in extra)) continue;
    const snapshot = extra.tagReview as Partial<TagReviewSnapshot> | null;
    if (
      snapshot?.version !== 1 ||
      typeof snapshot.reviewedAt !== "string" ||
      !snapshot.sources ||
      typeof snapshot.sources !== "object"
    )
      continue;
    snapshots.push(snapshot as TagReviewSnapshot);
  }
  snapshots.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  const sources = new Map<string, ReviewTagSource>();
  for (const snapshot of snapshots) {
    for (const [slug, source] of Object.entries(snapshot.sources)) {
      if (!["existing", "ai", "manual"].includes(source)) continue;
      // A later review sees previous AI/manual additions as existing. Keep the original source.
      if (!sources.has(slug)) sources.set(slug, source);
    }
  }
  return sources;
}
