"use client";
import { syncTagsFromMuseDAMAction, syncTagsToMuseDAMWithCurrentSystemAsBaseAction } from "@/app/tags/actions";
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
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface UpdateToMuseDialogProps {
  onSyncComplete?: () => void;
}

// 手动将当前系统标签同步到 museDAM
export function UpdateToMuseDialog({ onSyncComplete }: UpdateToMuseDialogProps) {
  const t = useTranslations("TagsPage");
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSync = async () => {
    setIsLoading(true);
    try {
      const result = await syncTagsToMuseDAMWithCurrentSystemAsBaseAction();
      if (result.success) {
        // toast.success(t("syncSuccess"));
        setOpen(false);
        onSyncComplete?.();
      } else {
        toast.error(result.message || t("syncFailed"));
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast.error(t("syncError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2" size="sm" >
          手动同步当前标签树到 MuseDAM
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmSyncTitle")}</AlertDialogTitle>
          <AlertDialogDescription style={{ whiteSpace: "pre-line" }}>
            确认同步么？同步后，当前标签树不存在的数据将会从 MuseDAM 删除
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleSync} disabled={isLoading}>
            {isLoading ? t("syncing") : t("confirmSync")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
