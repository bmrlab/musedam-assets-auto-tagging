import { Button } from "@/components/ui/button";
import { Loader2Icon, SaveIcon } from "lucide-react";

interface SettingsHeaderProps {
  hasChanges: boolean;
  isPending: boolean;
  onSave: () => void;
}

export function SettingsHeader({ hasChanges, isPending, onSave }: SettingsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-lg font-medium">打标开关</h1>
      </div>

      {hasChanges && (
        <Button onClick={onSave} disabled={isPending} className="gap-2">
          {isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SaveIcon className="size-4" />
          )}
          {isPending ? "保存中..." : "保存设置"}
        </Button>
      )}
    </div>
  );
}
