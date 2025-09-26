"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ClockCircleIcon, TagAIIcon, TagsIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/progress";
import { cn, formatSize } from "@/lib/utils";
import {
  AssetObject,
  AssetObjectExtra,
  AssetObjectTags,
  TaggingAuditStatus,
} from "@/prisma/client";
import { CheckIcon, DotIcon, Loader2Icon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveAuditItemsAction,
  AssetWithAuditItemsBatch,
  rejectAuditItemsAction,
} from "./actions";

export function ReviewItem({ assetObject, batch, onSuccess, CheckboxComponent, batchLoading }: AssetWithAuditItemsBatch & { CheckboxComponent: React.ReactNode, batchLoading?: boolean }) {
  const t = useTranslations("Tagging.Review");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);

  const realLoading = batchLoading || loading;
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
      if (!auditItems.length) {
        toast.error('历史脏数据，找不到对应的标签')
        setLoading(false);
        return;
      }
      try {
        await approveAuditItemsAction({
          assetObject,
          auditItems,
          append,
        });
        toast.success(t("applySuccess"));
        onSuccess?.();
      } catch (error: unknown) {
        console.log(error);
        toast.error(error instanceof Error ? error.message : t("applyFailed"));
      } finally {
        setLoading(false);
      }
    },
    [auditItemsSet, rejectedItems, assetObject],
  );

  const getThumbnailUrl = (asset: AssetObject) => {
    const extra = asset.extra as AssetObjectExtra | null;
    return extra?.thumbnailAccessUrl ?? "/file.svg";
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const handleReject = useCallback(async () => {
    setLoading(true);
    try {
      await rejectAuditItemsAction({ assetObject });
      toast.success(t("rejectSuccess"));
      onSuccess?.();
    } catch (error: unknown) {
      console.log(error);
      toast.error(error instanceof Error ? error.message : t("rejectFailed"));
    } finally {
      setLoading(false);
    }
  }, [assetObject, t, onSuccess]);

  return (
    <div className="bg-background border rounded-md px-6 pt-8 pb-6 space-y-6">
      {/* 资产基本信息 */}
      <div className="flex items-center gap-4">
        {CheckboxComponent}
        <div className="shrink-0 w-24 h-24 relative">
          <Image
            src={getThumbnailUrl(assetObject)}
            alt={assetObject.name}
            fill
            sizes="100px" // 这个是图片 optimize 的尺寸，不是前端显示的尺寸
            className="object-cover rounded-[10px]"
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-basic" title={assetObject.name}>
            {assetObject.name}
          </h3>
          {/* 所属文件夹 */}
          {/* <div className="flex items-center gap-1 text-sm text-basic-5 mt-1">
            <Folder className="h-4 w-4" />
            <span className="truncate" title={assetObject.materializedPath}>
              {assetObject.materializedPath}
            </span>
          </div> */}
          <div className="flex items-center gap-1 text-xs text-basic-5 mt-1">
            <span>{(assetObject.extra as AssetObjectExtra).extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>
              {formatSize((assetObject.extra as AssetObjectExtra).size)?.toLocaleString()}
            </span>
          </div>
        </div>

        {Array.from(auditItemsSet).find((auditItem) => auditItem.status === "pending") ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={realLoading}
              onClick={() => approveAuditItems({ append: true })}
              className="rounded-[4px] h-6 bg-primary-6 "
            >
              {loading ? <Loader2Icon className="size-[14px] animate-spin" /> : <CheckIcon className="size-[14px]" />}
              {t("add")}
            </Button>
            {/* <Button
              size="sm"
              onClick={() => approveAuditItems({ append: false })}
              className="rounded-[4px] h-6 bg-primary-6 "
            >
              <svg className="size-[14px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {t("replace")}
            </Button> */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-[4px] h-6 bg-background text-danger-6 border-solid border-danger-6 border hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                  disabled={realLoading}
                >
                  {loading ? <Loader2Icon className="size-[14px] animate-spin" /> : <XIcon className="size-[14px]" />}
                  {t("delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("rejectConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("rejectConfirmDescription", { assetName: assetObject.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("rejectConfirmCancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleReject}
                    className="bg-danger-6 text-white hover:bg-danger-7"
                  >
                    {t("rejectConfirmReject")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>

      {/* 标签信息 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 现有标签 */}
        <div className="bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4 col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <TagsIcon className="size-4" />
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
        <div className="col-span-1 flex flex-col gap-[6px]">
          {/* AI推荐标签 */}
          {batch.map(({ queueItem, taggingAuditItems }, index) => (
            <div
              key={queueItem.id}
              className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <TagAIIcon className="size-4" />
                <span className="text-sm font-medium">{t("aiRecommendedTags")}</span>
                <span className="text-xs text-basic-5">{t("basedOnTagSystem")}</span>
                {batch.length > 1 && index === 0 ? (
                  <span className="ml-2 inline-flex items-center px-[13px] py-[2px] rounded-[4px] text-xs text-danger-6 border border-danger-3 bg-danger-1">
                    {t("latest")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-basic-5 flex items-center gap-1">
                  <ClockCircleIcon className="size-3" />
                  {formatDate(queueItem.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {taggingAuditItems.map((auditItem) => (
                  <div
                    key={auditItem.id}
                    className={cn(
                      "relative py-2 pl-3 pr-8 rounded-[6px] border min-w-36",
                      {
                        "border-dashed":
                          (auditItem.leafTagId && rejectedItems.includes(auditItem.leafTagId)) ||
                          auditItem.status === "rejected",
                      },
                      {
                        "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-500 dark:border-blue-800":
                          auditItem.score >= 80,
                        "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-800":
                          auditItem.score >= 70 && auditItem.score < 80,
                        "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-500 dark:border-orange-800":
                          auditItem.score < 70,
                      },
                    )}
                  >
                    <div className="font-medium text-[13px] mb-[2px]">
                      {auditItem.tagPath.join(" > ")}
                    </div>
                    <div className="flex items-center gap-2 h-4">
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
                      <span className="text-[10px] ">{auditItem.score}%</span>
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
    </div>
  );
}
