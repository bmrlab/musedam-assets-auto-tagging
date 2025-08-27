import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ApplicationScope {
  scopeType: "all" | "specific";
  selectedFolders: Array<{
    id: string;
    name: string;
  }>;
}

interface ApplicationScopeSectionProps {
  applicationScope: ApplicationScope;
  onFolderSelection: () => void;
  onRemoveFolder: (folderId: string) => void;
  onScopeTypeChange: (scopeType: "all" | "specific") => void;
}

export function ApplicationScopeSection({
  applicationScope,
  onFolderSelection,
  onRemoveFolder,
  onScopeTypeChange,
}: ApplicationScopeSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>应用范围设置</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="font-medium">AI 打标范围</h3>
          <div
            className="border-2 border-dashed border-primary rounded-lg p-6 cursor-pointer hover:bg-primary/5 transition-colors text-center"
            onClick={onFolderSelection}
          >
            <div className="size-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
              📁
            </div>
            <p className="text-sm text-muted-foreground">点击选择要启用 AI 自动打标的资产范围</p>
          </div>

          <div className="space-y-4">
            {applicationScope.scopeType === "all" && (
              <div
                className="border rounded-lg p-4 cursor-pointer transition-all flex items-center gap-3 border-primary bg-primary/5"
                onClick={() => onScopeTypeChange("all")}
              >
                <div className="size-5 bg-muted rounded flex items-center justify-center">📁</div>
                <div>
                  <h4 className="font-medium">全部素材</h4>
                  <p className="text-sm text-muted-foreground">资产库所有现有及新上传的素材</p>
                </div>
              </div>
            )}

            {applicationScope.selectedFolders.map((folder) => (
              <div
                key={folder.id}
                className={cn(
                  "border rounded-lg p-4 cursor-pointer transition-all flex items-center justify-between",
                  applicationScope.scopeType === "specific"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                )}
                onClick={() => onScopeTypeChange("specific")}
              >
                <div className="flex items-center gap-3">
                  <div className="size-5 bg-muted rounded flex items-center justify-center">📁</div>
                  <div>
                    <h4 className="font-medium">{folder.name}</h4>
                    <p className="text-sm text-muted-foreground">当前文件夹及新上传的素材</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFolder(folder.id);
                  }}
                  className="h-8 w-8 p-0"
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">ℹ️</div>
              <div className="text-sm">
                <span className="font-medium text-amber-900 dark:text-amber-100">
                  仅选中的范围内的素材会进行 AI 自动打标
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
