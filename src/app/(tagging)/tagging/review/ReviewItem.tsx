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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClockCircleIcon, TagAIIcon, TagsIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/progress";
import { cn, formatSize } from "@/lib/utils";
import {
  AssetObjectExtra,
  AssetObjectTags,
  TaggingAuditStatus,
} from "@/prisma/client";
import { CheckIcon, DotIcon, Loader2Icon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveAuditItemsAction,
  AssetWithAuditItemsBatch,
  rejectAuditItemsAction,
} from "./actions";
import { slugToId } from "@/lib/slug";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { AssetThumbnail } from "@/components/AssetThumbnail";

export function ReviewItem({ assetObject, batch, onSuccess, CheckboxComponent, batchLoading }: AssetWithAuditItemsBatch & { CheckboxComponent: React.ReactNode, batchLoading?: boolean }) {
  const t = useTranslations("Tagging.Review");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);

  const realLoading = batchLoading || loading;

  const finalBatch = useMemo(() => {
    // 对于 taskType === 'default' 的 batch，只保留最新的那个
    let hasDefaultBatch = false;
    return batch.filter((group) => {
      if (group.queueItem.taskType === "default") {
        if (hasDefaultBatch) {
          return false; // 已经保留了一个 default batch，跳过后续的
        }
        hasDefaultBatch = true;
        return true; // 保留第一个（最新的）default batch
      }
      return true; // 非 default 类型的 batch 都保留
    })
  }, [batch]);

  // 获取被 filter 掉的 audit items（用于在 approve 时标记为 rejected）
  const filteredOutAuditItems = useMemo(() => {
    const finalBatchSet = new Set(finalBatch);
    const items: AssetWithAuditItemsBatch["batch"][number]["taggingAuditItems"][number][] = [];
    batch.forEach((group) => {
      if (!finalBatchSet.has(group)) {
        group.taggingAuditItems.forEach((auditItem) => {
          items.push(auditItem);
        });
      }
    });
    return items;
  }, [batch, finalBatch]);

  const auditItemsSet = useMemo(() => {
    const set = new Set<AssetWithAuditItemsBatch["batch"][number]["taggingAuditItems"][number]>();
    finalBatch.forEach(({ taggingAuditItems }) => {
      taggingAuditItems.forEach((auditItem) => {
        set.add(auditItem);
      });
    });
    return set;
  }, [finalBatch]);

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

      // 将被 filter 掉的 audit items 标记为 rejected
      const filteredOutItems = filteredOutAuditItems
        .filter(({ leafTagId }) => !!leafTagId)
        .map(({ id, leafTagId }) => ({
          id: id,
          leafTagId: leafTagId!,
          status: "rejected" as TaggingAuditStatus,
        }));

      // 合并两个数组
      const allAuditItems = [...auditItems, ...filteredOutItems];

      if (!allAuditItems.length) {
        toast.error(t("noCorrespondingTag"))
        setLoading(false);
        return;
      }
      try {
        await approveAuditItemsAction({
          assetObject,
          auditItems: allAuditItems,
          append,
        });
        toast.success(t("applySuccess"));
        onSuccess?.();
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : undefined
        if (errorMsg === 'Asset not found') {
          await rejectAuditItemsAction({ assetObject });
          toast.warning(t("assetDeleted"))
          onSuccess?.();
          return
        }
        toast.error(error instanceof Error ? error.message : t("applyFailed"));
      } finally {
        setLoading(false);
      }
    },
    [auditItemsSet, rejectedItems, assetObject, filteredOutAuditItems],
  );


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
    <div className="bg-background border rounded-[6px] px-6 pt-8 pb-6 space-y-6">
      {/* 资产基本信息 */}
      <div className="flex items-center gap-4">
        {CheckboxComponent}
        <div className="shrink-0 size-[86px] cursor-pointer relative" onClick={() => {
          const assetId = slugToId("assetObject", assetObject.slug)
          dispatchMuseDAMClientAction("goto", {
            url: `/detail/${assetId.toString()}`,
            target: "_blank",
          });
        }}>
          <AssetThumbnail
            asset={{
              thumbnailUrl: (assetObject?.extra as AssetObjectExtra | null)?.thumbnailAccessUrl,
              extension: (assetObject?.extra as AssetObjectExtra | null)?.extension,
            }}
            maxWidth={86}
            maxHeight={86}
            className="rounded-[10px] size-[86px]"
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
          <div className="flex items-center gap-0.5 text-xs text-basic-5 mt-1">
            <span>{(assetObject.extra as AssetObjectExtra).extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>
              {formatSize((assetObject.extra as AssetObjectExtra).size)?.toLocaleString()}
            </span>
          </div>
        </div>


        <div className="flex gap-2">
          {Array.from(auditItemsSet).find((auditItem) => auditItem.status === "pending") && <Button
            size="sm"
            disabled={realLoading}
            variant="default"
            onClick={() => approveAuditItems({ append: true })}
            className="h-[28px] rounded-[6px] px-2"
          >
            {loading ? <Loader2Icon className="size-[14px] animate-spin" /> : <CheckIcon className="size-[14px]" />}
            {t("add")}
          </Button>}
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
                variant="danger"
                className="h-[28px] rounded-[6px] px-2"
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
                  variant="dialogDanger"
                >
                  {t("rejectConfirmReject")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

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
          {finalBatch.map(({ queueItem, taggingAuditItems }, index) => (
            <div
              key={queueItem.id}
              className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <TagAIIcon className="size-4" />
                <span className="text-sm font-medium">{t("aiRecommendedTags")}</span>
                <span className="text-xs text-basic-5">{t("basedOnTagSystem")}</span>
                {finalBatch.length > 1 && index === 0 ? (
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
                      "relative py-[6px] px-2 rounded-[6px] border items-center flex gap-2",
                      {
                        "border-dashed":
                          (auditItem.leafTagId && rejectedItems.includes(auditItem.leafTagId)) ||
                          auditItem.status === "rejected",
                      },
                      {
                        "text-primary-6 bg-primary-1 border-[#A6C1FF]":
                          auditItem.score >= 80,
                        "text-[#52C41A] bg-[#F6FFED] border-[#95DE64]":
                          auditItem.score >= 70 && auditItem.score < 80,
                        "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069]":
                          auditItem.score < 70,
                      },
                    )}
                  >
                    <div className="font-medium text-[13px] leading-[18px]">
                      {auditItem.tagPath.join(" > ")}
                    </div>
                    <div className="flex items-center gap-[6px]">
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
                        className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current w-[60px]"
                      />
                      <span className="text-[10px] ">{auditItem.score}%</span>
                    </div>
                    {/* 操作按钮 */}
                    {auditItem.status === "pending" && auditItem.leafTagId ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className={cn(
                                "size-3 bg-transparent hover:bg-transparent text-basic-5 hover:text-current",
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
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{rejectedItems.includes(auditItem.leafTagId) ? t("tooltipAdd") : t("tooltipRemove")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
