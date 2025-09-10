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
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface SyncConfirmDialogProps {
  onSyncComplete?: () => void;
}

export function SyncConfirmDialog({ onSyncComplete }: SyncConfirmDialogProps) {
  const t = useTranslations("TagsPage");
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSync = async () => {
    setIsLoading(true);
    try {
      const result = await syncTagsFromMuseDAMAction();
      if (result.success) {
        toast.success(t("syncSuccess"));
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
        <Button variant="outline" className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          {t("syncFromMuseDAM")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmSyncTitle")}</AlertDialogTitle>
          <AlertDialogDescription style={{ whiteSpace: "pre-line" }}>
            {t("confirmSyncDescription")}
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
