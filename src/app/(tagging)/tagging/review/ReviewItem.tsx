"use client";
import { Button } from "@/components/ui/button";
import { AssetObjectExtra, AssetObjectTags, TaggingAuditStatus } from "@/prisma/client";
import { CheckCircle, DotIcon, Folder, Tag as TagIcon, XCircle } from "lucide-react";
import Image from "next/image";
import { AssetWithAuditItems } from "./actions";

export function ReviewItem({ asset }: { asset: AssetWithAuditItems }) {
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

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "text-blue-600 dark:text-blue-400";
    if (confidence >= 60) return "text-green-600 dark:text-green-400";
    return "text-orange-600 dark:text-orange-400";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 80) return "精准";
    if (confidence >= 60) return "平衡";
    return "宽泛";
  };

  const getStatusColor = (status: TaggingAuditStatus) => {
    switch (status) {
      case "pending":
        return "text-orange-600 dark:text-orange-400";
      case "approved":
        return "text-green-600 dark:text-green-400";
      case "rejected":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const getStatusText = (status: TaggingAuditStatus) => {
    switch (status) {
      case "pending":
        return "待审核";
      case "approved":
        return "已采纳";
      case "rejected":
        return "已调整";
      default:
        return "未知状态";
    }
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
            <span>{(asset.extra as AssetObjectExtra).size}</span>
            <DotIcon className="size-3" />
            {/* TODO: 这里应该是发起打标的时间，需要优化下 */}
            <span>{formatDate(asset.taggingAuditItems[0].createdAt)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            添加
          </Button>
          <Button variant="outline" size="sm">
            置盖
          </Button>
          <Button variant="outline" size="sm">
            拒绝
          </Button>
        </div>
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
            <div className="space-y-2">
              {asset.taggingAuditItems.map((auditItem) => (
                <div
                  key={auditItem.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">{auditItem.tagPath.join(" > ")}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {auditItem.tagPath.length}级标签 • ID: {auditItem.leafTagId}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* 置信度条 */}
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
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
                      </div>
                      <span className="text-xs text-muted-foreground">{auditItem.score}%</span>
                    </div>

                    {/* 置信度标签 */}
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${getConfidenceColor(
                        auditItem.score,
                      )} bg-current/10`}
                    >
                      {getConfidenceLabel(auditItem.score)}
                    </span>

                    {/* 状态 */}
                    <span className={`text-xs font-medium ${getStatusColor(auditItem.status)}`}>
                      {getStatusText(auditItem.status)}
                    </span>

                    {/* 操作按钮 */}
                    {auditItem.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2">
                          <CheckCircle className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2">
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
