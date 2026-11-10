import { AssetObjectExtra, TaggingQueueStatus } from "@/prisma/client";

/** 看板任务列表只需状态、耗时和失败码；完整 result 含特征决策/OCR，体积很大。 */
export type DashboardTaskListItem = {
  id: number;
  status: TaggingQueueStatus;
  startsAt: Date | null;
  endsAt: Date | null;
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
