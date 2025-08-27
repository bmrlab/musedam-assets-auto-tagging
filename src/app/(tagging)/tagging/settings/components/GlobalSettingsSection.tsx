import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
    <Card>
      <CardHeader>
        <CardTitle>全局设置</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">打标开关</h3>
          </div>
          <Switch checked={isTaggingEnabled} onCheckedChange={onTaggingEnabledChange} />
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">AI 自动打标引擎</h3>
              <p className="text-sm text-muted-foreground mt-1">
                开启中，AI 将可根据配置及系统标签体系对资产进行打标
              </p>
            </div>
            <Switch checked={isTaggingEnabled} disabled />
          </div>

          <Button variant="outline" className="gap-2">
            <SettingsIcon className="size-4" />
            管理标签体系
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
