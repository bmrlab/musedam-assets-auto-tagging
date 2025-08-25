"use client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { AssetObjectExtra, AssetObjectTags, TaggingAuditStatus } from "@/prisma/client";
import { CheckIcon, DotIcon, Folder, Loader2Icon, Tag as TagIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { approveAuditItemsAction, AssetWithAuditItems } from "./actions";

export function ReviewItem({ asset }: { asset: AssetWithAuditItems }) {
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);

  const approveAuditItems = useCallback(
    async ({ append }: { append: boolean }) => {
      setLoading(true);
      const { taggingAuditItems, ...assetObject } = asset;
      const auditItems: {
        id: number;
        leafTagId: number | null;
        status: TaggingAuditStatus;
      }[] = taggingAuditItems.map((taggingAuditItem) => ({
        id: taggingAuditItem.id,
        leafTagId: taggingAuditItem.leafTagId,
        status: rejectedItems.includes(taggingAuditItem.id) ? "rejected" : "approved",
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
    [asset, rejectedItems],
  );

  const getThumbnailUrl = (asset: AssetWithAuditItems) => {
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
            src={getThumbnailUrl(asset)!}
            alt={asset.name}
            fill
            sizes="100px" // 这个是图片 optimize 的尺寸，不是前端显示的尺寸
            className="object-cover rounded-sm"
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate" title={asset.name}>
            {asset.name}
          </h3>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <Folder className="h-4 w-4" />
            <span className="truncate" title={asset.materializedPath}>
              {asset.materializedPath}
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
            <span>{(asset.extra as AssetObjectExtra).extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>{(asset.extra as AssetObjectExtra).size?.toLocaleString()} Bytes</span>
            <DotIcon className="size-3" />
            {/* TODO: 这里应该是发起打标的时间，需要优化下 */}
            <span>{formatDate(asset.taggingAuditItems[0].createdAt)}</span>
          </div>
        </div>

        {loading ? (
          <div>
            <Loader2Icon className="size-4 animate-spin" />
          </div>
        ) : asset.taggingAuditItems.find((auditItem) => auditItem.status === "pending") ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => approveAuditItems({ append: true })}>
              添加
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => approveAuditItems({ append: false })}
            >
              置盖
            </Button>
            <Button variant="outline" size="sm">
              拒绝
            </Button>
          </div>
        ) : null}
      </div>

      {/* 标签信息 */}
      <div className="flex flex-row items-items-stretch gap-4">
        {/* 现有标签 */}
        <div className="flex-1 bg-zinc-50 rounded-md p-4">
          <div className="flex items-center gap-2 mb-2">
            <TagIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">标签</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(asset.tags as AssetObjectTags).map((tag, index) => (
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
        {asset.taggingAuditItems.length > 0 && (
          <div className="flex-1 bg-zinc-50 rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <TagIcon className="h-4 w-4" />
              <span className="text-sm font-medium">AI 推荐标签</span>
              <span className="text-xs text-muted-foreground">基于标签体系匹配</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {asset.taggingAuditItems.map((auditItem) => (
                <div
                  key={auditItem.id}
                  className={cn(
                    "relative py-2 pl-3 pr-8 rounded-md border min-w-36",
                    {
                      "border-dashed":
                        rejectedItems.includes(auditItem.id) || auditItem.status === "rejected",
                    },
                    {
                      "text-blue-500 bg-blue-50 border-blue-500": auditItem.score >= 80,
                      "text-green-500 bg-green-50 border-green-500":
                        auditItem.score >= 70 && auditItem.score < 80,
                      "text-orange-500 bg-orange-50 border-orange-500": auditItem.score < 70,
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
                  {auditItem.status === "pending" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn(
                        "absolute top-3 right-2 p-0",
                        "size-3 bg-transparent hover:bg-transparent text-current hover:text-current/90",
                      )}
                      onClick={() =>
                        setRejectedItems((rejectedItems) => {
                          const index = rejectedItems.indexOf(auditItem.id);
                          if (index >= 0) {
                            return [
                              ...rejectedItems.slice(0, index),
                              ...rejectedItems.slice(index + 1),
                            ];
                          } else {
                            return [...rejectedItems, auditItem.id];
                          }
                        })
                      }
                    >
                      {rejectedItems.includes(auditItem.id) ? (
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
        )}
      </div>
    </div>
  );
}
