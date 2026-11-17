import { AssetObjectExtra, TaggingQueueStatus } from "@/prisma/client";

/** 看板仅投影展示字段；不读取含特征决策/OCR 的完整 result / extra。 */
export type DashboardTaskListItem = {
  id: number;
  status: TaggingQueueStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Enqueue-time price; null for historical tasks without a recorded snapshot. */
  creditCost: number | null;
  result: { error?: string | { code?: string } } | Record<string, never>;
  assetObject: {
    id: number;
    name: string;
    slug: string;
    extra: Pick<AssetObjectExtra, "thumbnailAccessUrl" | "extension" | "size">;
  };
};

export function applyThumbnailUpdates(
  tasks: DashboardTaskListItem[],
  thumbnailBySlug: Map<string, string>,
): DashboardTaskListItem[] {
  if (thumbnailBySlug.size === 0) return tasks;
  return tasks.map((task) => {
    const nextUrl = thumbnailBySlug.get(task.assetObject.slug);
    if (!nextUrl || task.assetObject.extra.thumbnailAccessUrl === nextUrl) return task;
    return {
      ...task,
      assetObject: {
        ...task.assetObject,
        extra: {
          ...task.assetObject.extra,
          thumbnailAccessUrl: nextUrl,
        },
      },
    };
  });
}
