"use client";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getTeamHasTags } from "@/app/tags/actions";
import { fetchDashboardStats } from "../../dashboard/actions";

interface AITaggingConfirmDialogProps {
    metadataAvailable?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    action: "enable" | "disable";
    onConfirm: () => void;
    onCancel: () => void;
}

export function AITaggingConfirmDialog({
    metadataAvailable = false,
    open,
    onOpenChange,
    action,
    onConfirm,
    onCancel,
}: AITaggingConfirmDialogProps) {
    const t = useTranslations("Tagging.Settings.ConfirmDialog");
    const isEnable = action === "enable";

    const [loading, setLoading] = useState(false);
    const [hasTags, setHasTags] = useState(false);
    const [taskStats, setTaskStats] = useState({ pending: 0, processing: 0, completed: 0, failed: 0 });

    // 获取团队标签和任务统计数据
    useEffect(() => {
        if (!open) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                // 获取团队是否有标签
                const hasTagsResult = await getTeamHasTags();
                if (hasTagsResult.success && hasTagsResult.data) {
                    setHasTags(hasTagsResult.data.hasTags);
                }

                // 获取任务统计数据
                const statsResult = await fetchDashboardStats();
                if (statsResult.success && statsResult.data) {
                    const { processing, pending, totalCompleted, failed } = statsResult.data.stats;
                    setTaskStats({ processing, pending, completed: totalCompleted, failed });
                }
            } catch (error) {
                console.error("Failed to fetch data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [open]);

    const notFinishedTasks = taskStats.pending + taskStats.processing;


    // 根据场景确定标题
    const getTitle = () => {
        if (metadataAvailable) return t(isEnable ? "enableTagSystemTitle" : "disableTagSystemTitle");
        if (isEnable) {
            return t("enableTitle");
        } else {
            return t("disableTitle");
        }
    };

    // 根据场景确定描述内容
    const getDescription = () => {
        if (isEnable) {
            if (hasTags) {
                return t("enableWithTagsDescription");
            } else {
                return t("enableWithoutTagsDescription");
            }
        } else {
            if (notFinishedTasks > 0) {
                return t("disableWithTasksDescription", { count: notFinishedTasks });
            } else {
                return t("disableWithoutTasksDescription");
            }
        }
    };

    // 根据场景确定提示内容
    const getHint = () => {
        if (isEnable) {
            return t("enableHint");
        } else {
            return t("disableHint");
        }
    };

    // 根据场景确定按钮文本和样式
    const getButtonProps: () => ({
        text: string;
        variant: "default" | "dialogDanger";
    }) = () => {
        if (isEnable) {
            return {
                text: t("confirmEnable"),
                variant: "default"
            };
        } else {
            return {
                text: t("confirmDisable"),
                variant: "dialogDanger"
            };
        }
    };

    const buttonProps = getButtonProps();

    const handleConfirm = () => {
        onConfirm();
        onOpenChange(false);
    };

    const handleCancel = () => {
        onCancel();
        onOpenChange(false);
    };

    const showRadio = isEnable && hasTags

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-base font-semibold">
                        {getTitle()}
                    </AlertDialogTitle>
                </AlertDialogHeader>
                {loading ? (
                    // 骨架屏
                    <>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-3/4" />
                            </div>
                            <Skeleton className="h-12 w-full" />
                        </div>

                        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <Skeleton className="h-8 w-20" />
                            <Skeleton className="h-8 w-20" />
                        </AlertDialogFooter>
                    </>
                ) : (
                    // 实际内容
                    <>

                        <div className="space-y-4">
                            <AlertDialogDescription className="text-sm text-basic-7">
                                {getDescription()}
                            </AlertDialogDescription>

                            {/* 开启时的选项 */}
                            {showRadio && (
                                <div className="space-y-1">
                                    <RadioGroup defaultValue="autoRealtime" className="space-y-2">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="autoRealtime" id="autoRealtime" />
                                            <Label htmlFor="autoRealtime" className="text-sm text-basic-7 font-normal">
                                                {t("autoRealtimeOption")}
                                            </Label>
                                        </div>
                                    </RadioGroup>
                                    <p className="text-xs text-basic-5 ml-6 leading-4">
                                        {t("autoRealtimeDescription")}
                                    </p>
                                </div>
                            )}

                            {/* 提示信息 */}
                            {!showRadio && <div className="flex items-start px-3 py-[14px] rounded-[8px] border border-primary-5 bg-primary-1 text-xs text-basic-8 ">
                                💡<div><span className="font-semibold text-start ">{t("tips")}</span>{getHint()}</div>
                            </div>}
                        </div>

                        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <AlertDialogCancel onClick={handleCancel} className="mt-0 min-w-20">
                                {(!hasTags && isEnable) ? t("iUnderstand") : t("cancel")}
                            </AlertDialogCancel>
                            {(hasTags || !isEnable) && <AlertDialogAction
                                onClick={handleConfirm}
                                variant={buttonProps.variant}
                            >
                                {buttonProps.text}
                            </AlertDialogAction>}
                        </AlertDialogFooter>
                    </>
                )}
            </AlertDialogContent>
        </AlertDialog>
    );
}
