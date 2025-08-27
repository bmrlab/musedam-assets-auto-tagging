import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";

interface TaggingModeSectionProps {
  taggingMode: "direct" | "review";
  onTaggingModeChange: (mode: "direct" | "review") => void;
}

export function TaggingModeSection({ taggingMode, onTaggingModeChange }: TaggingModeSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>打标模式</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-all",
              taggingMode === "direct"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onTaggingModeChange("direct")}
          >
            <div className="text-center">
              <h3 className="font-medium mb-2">直接应用</h3>
              <p className="text-sm text-muted-foreground">AI 打标直接应用到资产标签</p>
            </div>
          </div>

          <div
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-all",
              taggingMode === "review"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onTaggingModeChange("review")}
          >
            <div className="text-center">
              <h3 className="font-medium mb-2">审核模式</h3>
              <p className="text-sm text-muted-foreground">需人工审核后应用到资产标签</p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex gap-3">
            <InfoIcon className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-medium text-blue-900 dark:text-blue-100">
                初次使用建议审核模式：
              </span>
              <span className="text-blue-800 dark:text-blue-200 ml-1">
                通过人工审核可以评估 AI 打标效果，待准确率满足要求后在切换为直接应用模式
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
