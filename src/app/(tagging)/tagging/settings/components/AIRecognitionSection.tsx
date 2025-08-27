import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";

interface AIRecognitionSectionProps {
  recognitionMode: "precise" | "balanced" | "broad";
  onRecognitionModeChange: (mode: "precise" | "balanced" | "broad") => void;
}

export function AIRecognitionSection({
  recognitionMode,
  onRecognitionModeChange,
}: AIRecognitionSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle>AI 识别设置</CardTitle>
        <InfoIcon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-all",
              recognitionMode === "precise"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onRecognitionModeChange("precise")}
          >
            <div className="text-center space-y-2">
              <h3 className="font-medium">精准模式</h3>
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                80-100% 置信度
              </div>
              <p className="text-xs text-muted-foreground">优先准确性，适合打标要求严格的场景</p>
            </div>
          </div>

          <div
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-all relative",
              recognitionMode === "balanced"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onRecognitionModeChange("balanced")}
          >
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2">
                <h3 className="font-medium">平衡模式</h3>
                <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">
                  推荐
                </span>
              </div>
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                70-100% 置信度
              </div>
              <p className="text-xs text-muted-foreground">
                平衡标签准确性与覆盖率，适合日常大多数场景
              </p>
            </div>
          </div>

          <div
            className={cn(
              "border rounded-lg p-4 cursor-pointer transition-all",
              recognitionMode === "broad"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onRecognitionModeChange("broad")}
          >
            <div className="text-center space-y-2">
              <h3 className="font-medium">宽泛模式</h3>
              <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                60-100% 置信度
              </div>
              <p className="text-xs text-muted-foreground">优先标签覆盖率，适合内容智能分类</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
