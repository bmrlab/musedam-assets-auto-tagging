"use client";
import { syncTagsFromMuseDAMAction } from "@/app/tags/actions";
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
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface SyncConfirmDialogProps {
  onSyncComplete?: () => void;
}

export function SyncConfirmDialog({ onSyncComplete }: SyncConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSync = async () => {
    setIsLoading(true);
    try {
      const result = await syncTagsFromMuseDAMAction();
      if (result.success) {
        toast.success("从 MuseDAM 同步标签成功");
        setOpen(false);
        onSyncComplete?.();
      } else {
        toast.error(result.message || "同步失败");
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast.error("同步时发生错误");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />从 MuseDAM 同步
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认同步标签</AlertDialogTitle>
          <AlertDialogDescription>
            此操作将：
            <br />
            • 删除当前系统中的所有标签
            <br />
            • 从 MuseDAM 重新拉取完整的标签体系
            <br />
            • 所有本地未保存的标签修改将丢失
            <br />
            <br />
            确定要继续吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleSync} disabled={isLoading}>
            {isLoading ? "同步中..." : "确认同步"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
