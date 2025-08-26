"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, TestTube } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // (window as any).iframeRef = iframeRef;

    const handleMessage = (event: MessageEvent) => {
      if (!/^museDAM/.test(event.data.type)) {
        return;
      }
      if (event.data.type === "museDAM-selector-page-mounted") {
        setTimeout(() => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: "museDAM-selector-init",
              data: {
                dataLimit: [
                  { type: "image", limit: 1 },
                  { type: "video", limit: 1 },
                ],
                theme: "light",
              },
            },
            "*",
          );
        }, 1000);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    setSelectedAssets([]);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedAssets([]);
  };

  const handleMessage = useCallback((event: MessageEvent) => {
    // 安全检查：确保消息来源是信任的
    if (!event.origin.includes("musedam.test.tezign.com")) {
      return;
    }

    const { type, payLoad } = event.data;

    switch (type) {
      case "museDAM-selector-page-mounted":
        console.log("页面加载完成");
        break;
      case "museDAM-selector-confirm":
        console.log("用户确认选择");
        const assets = payLoad.selectedAssets as SelectedAsset[];
        setSelectedAssets(assets);
        handleStartTagging(assets);
        break;
      case "museDAM-selector-cancel":
        console.log("用户取消操作");
        handleCloseDialog();
        break;
      case "museDAM-selector-choiceChange":
        console.log("选择内容变化");
        break;
      case "museDAM-selector-page-unMounted":
        console.log("页面卸载");
        break;
    }
  }, []);

  const handleStartTagging = async (assets: SelectedAsset[]) => {
    if (assets.length === 0) {
      toast.error("未选择任何素材");
      return;
    }

    setIsProcessing(true);

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
    } finally {
      setIsProcessing(false);
      handleCloseDialog();
    }
  };

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [handleMessage]);

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
              <p>• 点击"选择素材测试"按钮，从 MuseDAM 中选择需要测试的素材</p>
              <p>• 系统将自动为选中的素材发起 AI 打标任务</p>
              <p>• 可以在"控制面板"查看打标进度和结果</p>
              <p>• 可以在"AI打标审核"中查看和审核打标结果</p>
            </div>
          </div>
        </div>
      </div>

      {/* 操作区域 */}
      <div className="flex justify-center">
        <Button onClick={handleOpenDialog} size="lg" className="gap-2">
          <TestTube className="size-4" />
          选择素材测试
        </Button>
      </div>

      {/* 素材选择器 Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[90vw] sm:max-h-[90vh] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <TestTube className="size-5 text-primary" />
              选择素材进行打标测试
            </DialogTitle>
            <DialogDescription>从 MuseDAM 中选择需要测试 AI 打标功能的素材</DialogDescription>
          </DialogHeader>

          {/* 处理状态覆盖层 */}
          {isProcessing && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="text-center space-y-4">
                <Loader2 className="size-12 animate-spin text-primary mx-auto" />
                <div>
                  <p className="font-medium">正在发起打标任务...</p>
                  <p className="text-sm text-muted-foreground">
                    已选择 {selectedAssets.length} 个素材
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* iframe 容器 */}
          <div className="flex-1 h-[70vh]">
            <iframe
              ref={iframeRef}
              src="https://musedam.test.tezign.com/outer"
              className="w-full h-full border-0"
              title="MuseDAM 素材选择器"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
