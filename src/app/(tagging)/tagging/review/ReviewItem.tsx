"use client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  AssetObject,
  AssetObjectExtra,
  AssetObjectTags,
  TaggingAuditStatus,
} from "@/prisma/client";
import { CheckIcon, DotIcon, Folder, Loader2Icon, Tag as TagIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { approveAuditItemsAction, AssetWithAuditItemsBatch } from "./actions";

export function ReviewItem({ assetObject, batch }: AssetWithAuditItemsBatch) {
  const t = useTranslations("Tagging.Review");
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);

  const auditItemsSet = useMemo(() => {
    const set = new Set<AssetWithAuditItemsBatch["batch"][number]["taggingAuditItems"][number]>();
    batch.forEach(({ taggingAuditItems }) => {
      taggingAuditItems.forEach((auditItem) => {
        set.add(auditItem);
      });
    });
    return set;
  }, [batch]);

  const approveAuditItems = useCallback(
    async ({ append }: { append: boolean }) => {
      setLoading(true);
      const auditItems: {
        id: number;
        leafTagId: number;
        status: TaggingAuditStatus;
      }[] = Array.from(auditItemsSet)
        .filter(({ leafTagId }) => !!leafTagId)
        .map(({ id, leafTagId }) => ({
          id: id,
          leafTagId: leafTagId!,
          status: rejectedItems.includes(leafTagId!) ? "rejected" : "approved",
        }));
      try {
        await approveAuditItemsAction({
          assetObject,
          auditItems,
          append,
        });
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    },
    [auditItemsSet, rejectedItems, assetObject],
  );

  const getThumbnailUrl = (asset: AssetObject) => {
    const extra = asset.extra as AssetObjectExtra | null;
    return extra?.thumbnailAccessUrl;
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  return (
    <div className="bg-background border rounded-md px-6 pt-8 pb-6 space-y-6">
      {/* 资产基本信息 */}
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-24 h-24 relative">
          <Image
            src={getThumbnailUrl(assetObject)!}
            alt={assetObject.name}
            fill
            sizes="100px" // 这个是图片 optimize 的尺寸，不是前端显示的尺寸
            className="object-cover rounded-sm"
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate" title={assetObject.name}>
            {assetObject.name}
          </h3>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <Folder className="h-4 w-4" />
            <span className="truncate" title={assetObject.materializedPath}>
              {assetObject.materializedPath}
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <span>{(assetObject.extra as AssetObjectExtra).extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>{(assetObject.extra as AssetObjectExtra).size?.toLocaleString()} Bytes</span>
          </div>
        </div>

        {loading ? (
          <div>
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : Array.from(auditItemsSet).find((auditItem) => auditItem.status === "pending") ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => approveAuditItems({ append: true })}>
              {t("add")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => approveAuditItems({ append: false })}
            >
              {t("replace")}
            </Button>
            <Button variant="outline" size="sm">
              {t("reject")}
            </Button>
          </div>
        ) : null}
      </div>

      {/* 标签信息 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 现有标签 */}
        <div className="flex-1 bg-muted rounded-md p-4">
          <div className="flex items-center gap-2 mb-2">
            <TagIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("tags")}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(assetObject.tags as AssetObjectTags).map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center px-2 py-1 rounded-sm text-xs border bg-background text-foreground"
              >
                {tag.tagPath.join(" > ")}
              </span>
            ))}
          </div>
        </div>

        {/* AI推荐标签 */}
        {batch.map(({ queueItem, taggingAuditItems }) => (
          <div key={queueItem.id} className="flex-1 bg-muted rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <TagIcon className="h-4 w-4" />
              <span className="text-sm font-medium">{t("aiRecommendedTags")}</span>
              <span className="text-xs text-muted-foreground">{t("basedOnTagSystem")}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDate(queueItem.createdAt)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {taggingAuditItems.map((auditItem) => (
                <div
                  key={auditItem.id}
                  className={cn(
                    "relative py-2 pl-3 pr-8 rounded-md border min-w-36",
                    {
                      "border-dashed":
                        (auditItem.leafTagId && rejectedItems.includes(auditItem.leafTagId)) ||
                        auditItem.status === "rejected",
                    },
                    {
                      "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-500 dark:border-blue-800": auditItem.score >= 80,
                      "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-800":
                        auditItem.score >= 70 && auditItem.score < 80,
                      "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-500 dark:border-orange-800": auditItem.score < 70,
                    },
                  )}
                >
                  <div className="font-medium text-sm mb-2">{auditItem.tagPath.join(" > ")}</div>
                  <div className="flex items-center gap-2">
                    {/*<div className="w-16 h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          auditItem.score >= 80
                            ? "bg-blue-500"
                            : auditItem.score >= 60
                              ? "bg-green-500"
                              : "bg-orange-500"
                        }`}
                        style={{ width: `${auditItem.score}%` }}
                      />
                    </div>*/}
                    <Progress
                      value={auditItem.score}
                      className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current"
                    />
                    <span className="text-xs text-muted-foreground">{auditItem.score}%</span>
                  </div>
                  {/* 操作按钮 */}
                  {auditItem.status === "pending" && auditItem.leafTagId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        "absolute top-3 right-2 p-0",
                        "size-3 bg-transparent hover:bg-transparent text-current hover:text-current/90",
                      )}
                      onClick={() =>
                        setRejectedItems((rejectedItems) => {
                          if (!auditItem.leafTagId) return [...rejectedItems];
                          const index = rejectedItems.indexOf(auditItem.leafTagId);
                          if (index >= 0) {
                            return [
                              ...rejectedItems.slice(0, index),
                              ...rejectedItems.slice(index + 1),
                            ];
                          } else {
                            return [...rejectedItems, auditItem.leafTagId];
                          }
                        })
                      }
                    >
                      {rejectedItems.includes(auditItem.leafTagId) ? (
                        <CheckIcon className="h-3 w-3" />
                      ) : (
                        <XIcon className="h-3 w-3" />
                      )}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
