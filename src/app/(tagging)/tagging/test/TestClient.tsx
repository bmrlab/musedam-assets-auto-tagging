"use client";

import { Button } from "@/components/ui/button";
import { dispatchMuseDAMClientAction } from "@/musedam/embed";
import { Loader2, TestTube } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { startTaggingTasksAction } from "./actions";

interface SelectedAsset {
  id: string; // 素材唯一标识
  name: string; // 素材名称
  extension: string; // 文件扩展名
  size: number; // 文件大小（字节）
  url?: string; // 素材访问链接
  thumbnail?: string; // 缩略图链接
  width?: number; // 图片宽度（图片类型）
  height?: number; // 图片高度（图片类型）
  type?: string; // 素材类型
  folderId?: number; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

export default function TestClient() {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAssetSelection = async () => {
    try {
      setIsProcessing(true);
      const res = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
      console.log("素材选择结果:", res);

      if (res && typeof res === "object") {
        const { selectedAssets } = res;
        console.log("selectedAssets:", selectedAssets);

        if (selectedAssets && Array.isArray(selectedAssets) && selectedAssets.length > 0) {
          await handleStartTagging(selectedAssets);
        } else {
          console.log("没有选择素材或返回格式不正确");
          toast.info("未选择任何素材");
        }
      } else {
        console.log("没有选择素材或返回格式不正确");
        toast.info("未选择任何素材");
      }
    } catch (error) {
      console.error("选择素材失败:", error);
      toast.error("选择素材失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartTagging = useCallback(async (assets: SelectedAsset[]) => {
    if (assets.length === 0) {
      toast.error("未选择任何素材");
      return;
    }

    try {
      const result = await startTaggingTasksAction(assets);

      if (result.success) {
        const { successCount, failedCount, failedAssets } = result.data;

        if (failedCount === 0) {
          toast.success(`成功发起 ${successCount} 个素材的打标任务`);
        } else {
          toast.warning(`发起打标任务完成：成功 ${successCount} 个，失败 ${failedCount} 个`, {
            description:
              failedAssets.length > 0 ? `失败的素材：${failedAssets.join(", ")}` : undefined,
          });
        }
      } else {
        toast.error("发起打标任务失败", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("发起打标任务时出错:", error);
      toast.error("发起打标任务时出错");
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-3">
        <TestTube className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">测试打标</h1>
          <p className="text-muted-foreground">选择素材并测试 AI 自动打标功能</p>
        </div>
      </div>

      {/* 功能介绍 */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
        <div className="flex gap-3">
          <TestTube className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">功能说明</h3>
            <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <p>• 点击&ldquo;选择素材测试&rdquo;按钮，从 MuseDAM 中选择需要测试的素材</p>
              <p>• 系统将自动为选中的素材发起 AI 打标任务</p>
              <p>• 可以在&ldquo;控制面板&rdquo;查看打标进度和结果</p>
              <p>• 可以在&ldquo;AI打标审核&rdquo;中查看和审核打标结果</p>
            </div>
          </div>
        </div>
      </div>

      {/* 操作区域 */}
      <div className="flex justify-center">
        <Button onClick={handleAssetSelection} size="lg" className="gap-2" disabled={isProcessing}>
          {isProcessing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              正在处理...
            </>
          ) : (
            <>
              <TestTube className="size-4" />
              选择素材测试
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
