import { TaggingSettingsData } from "@/app/(tagging)/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ApplicationScopeSectionProps {
  applicationScope: TaggingSettingsData["applicationScope"];
  onFolderSelection: () => void;
  onRemoveFolder: (folderSlug: string) => void;
  onScopeTypeChange: (scopeType: "all" | "specific") => void;
}

export function ApplicationScopeSection({
  applicationScope,
  onFolderSelection,
  onRemoveFolder,
  onScopeTypeChange,
}: ApplicationScopeSectionProps) {
  const t = useTranslations("Tagging.Settings.ApplicationScope");

  return (
    <div className="space-y-6">
      {/* 应用范围设置 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-sm">{t("title")}</h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium">{t("scope")}</h3>
            <div
              className="border-2 border-dashed border-primary rounded-lg p-6 cursor-pointer hover:bg-primary/5 transition-colors text-center"
              onClick={onFolderSelection}
            >
              <div className="size-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                📁
              </div>
              <p className="text-sm text-muted-foreground">{t("selectScopeDesc")}</p>
            </div>

            <div className="space-y-4">
              {applicationScope.scopeType === "all" && (
                <div
                  className="border rounded-lg p-4 cursor-pointer transition-all flex items-center gap-3 border-primary bg-primary/5"
                  onClick={() => onScopeTypeChange("all")}
                >
                  <div className="size-5 bg-muted rounded flex items-center justify-center">📁</div>
                  <div>
                    <h4 className="font-medium">{t("allAssets")}</h4>
                    <p className="text-sm text-muted-foreground">{t("allAssetsDesc")}</p>
                  </div>
                </div>
              )}

              {applicationScope.selectedFolders.map((folder) => (
                <div
                  key={folder.slug}
                  className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all flex items-center justify-between",
                    applicationScope.scopeType === "specific"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                  onClick={() => onScopeTypeChange("specific")}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-5 bg-muted rounded flex items-center justify-center">
                      📁
                    </div>
                    <div>
                      <h4 className="font-medium">{folder.name}</h4>
                      <p className="text-sm text-muted-foreground">{t("currentAndNewAssets")}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFolder(folder.slug);
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
                    {t("onlySelectedScope")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
