import type { MetadataSource } from "@/lib/metadata/types";
import type { Prisma, TaggingAuditStatus } from "@/prisma/client";
export type MetadataReviewFilters = {
  status: TaggingAuditStatus | "all";
  source: MetadataSource | "all";
  confidence: "all" | "high" | "medium" | "low";
  time: "all" | "today" | "week" | "month";
  search: string;
};
export const defaultMetadataReviewFilters: MetadataReviewFilters = {
  status: "pending",
  source: "all",
  confidence: "all",
  time: "all",
  search: "",
};
export function metadataReviewWhere(
  teamId: number,
  filters: MetadataReviewFilters,
  now = new Date(),
  tagMatches: number[] = [],
): Prisma.MetadataAuditItemWhereInput {
  if (
    !["all", "pending", "approved", "rejected"].includes(filters.status) ||
    !["all", "basicInfo", "materializedPath", "contentAnalysis"].includes(filters.source) ||
    !["all", "high", "medium", "low"].includes(filters.confidence) ||
    !["all", "today", "week", "month"].includes(filters.time) ||
    typeof filters.search !== "string" ||
    filters.search.length > 200
  )
    throw new Error("Invalid query");
  const AND: Prisma.MetadataAuditItemWhereInput[] = [];
  if (filters.source !== "all")
    AND.push({ prediction: { path: ["sources"], array_contains: [{ source: filters.source }] } });
  if (filters.confidence !== "all")
    AND.push({
      prediction: {
        path: ["score"],
        ...(filters.confidence === "high"
          ? { gte: 80 }
          : filters.confidence === "medium"
            ? { gte: 60, lt: 80 }
            : { lt: 60 }),
      },
    });
  if (filters.time !== "all") {
    const since = new Date(now);
    if (filters.time === "today") since.setHours(0, 0, 0, 0);
    else since.setDate(since.getDate() - (filters.time === "week" ? 7 : 30));
    AND.push({ queueItem: { createdAt: { gte: since } } });
  }
  const search = filters.search.trim();
  if (search)
    AND.push({
      OR: [
        { assetObject: { name: { contains: search, mode: "insensitive" } } },
        { assetObject: { description: { contains: search, mode: "insensitive" } } },
        ...(tagMatches.length ? [{ assetObjectId: { in: tagMatches } }] : []),
      ],
    });
  return { teamId, ...(filters.status === "all" ? {} : { status: filters.status }), AND };
}
