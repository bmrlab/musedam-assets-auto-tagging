import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";

interface AIRecognitionSectionProps {
  recognitionAccuracy: "precise" | "balanced" | "broad";
  onRecognitionAccuracyChange: (accuracy: "precise" | "balanced" | "broad") => void;
}

export function AIRecognitionSection({
  recognitionAccuracy,
  onRecognitionAccuracyChange,
}: AIRecognitionSectionProps) {
  return (
    <div className="space-y-6">
      {/* AI 识别设置 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <h3 className="font-medium text-sm">AI 识别设置</h3>
          <InfoIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              className={cn(
                "border rounded-lg p-6 cursor-pointer transition-all",
                recognitionAccuracy === "precise"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => onRecognitionAccuracyChange("precise")}
            >
              <div className="text-center space-y-3">
                <h3 className="font-medium">精准模式</h3>
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  80-100% 置信度
                </div>
                <p className="text-xs text-muted-foreground">优先准确性，适合打标要求严格的场景</p>
              </div>
            </div>

            <div
              className={cn(
                "border rounded-lg p-6 cursor-pointer transition-all relative",
                recognitionAccuracy === "balanced"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => onRecognitionAccuracyChange("balanced")}
            >
              <div className="text-center space-y-3">
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
                "border rounded-lg p-6 cursor-pointer transition-all",
                recognitionAccuracy === "broad"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => onRecognitionAccuracyChange("broad")}
            >
              <div className="text-center space-y-3">
                <h3 className="font-medium">宽泛模式</h3>
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  60-100% 置信度
                </div>
                <p className="text-xs text-muted-foreground">优先标签覆盖率，适合内容智能分类</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
