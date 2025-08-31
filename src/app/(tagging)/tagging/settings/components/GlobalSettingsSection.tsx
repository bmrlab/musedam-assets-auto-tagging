import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsIcon } from "lucide-react";

interface GlobalSettingsSectionProps {
  isTaggingEnabled: boolean;
  onTaggingEnabledChange: (enabled: boolean) => void;
}

export function GlobalSettingsSection({
  isTaggingEnabled,
  onTaggingEnabledChange,
}: GlobalSettingsSectionProps) {
  return (
    <div className="space-y-6">
      {/* AI 自动打标引擎 */}
      <div className="bg-background border rounded-lg">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">AI 自动打标引擎</h3>
              <p className="text-sm text-muted-foreground mt-1">
                开启中，AI 将可根据配置及系统标签体系对资产进行打标
              </p>
            </div>
            <Switch checked={isTaggingEnabled} onCheckedChange={onTaggingEnabledChange} />
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <SettingsIcon className="size-4" />
            <Button variant="outline" size="sm">
              管理标签体系
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
