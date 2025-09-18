import { TaggingSettingsData } from "@/app/(tagging)/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { File, Folder, FolderIcon, InfoIcon, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from 'next/image';

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
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="font-medium text-sm">{t("scope")}</h3>
            <div
              className="border-1 border-dashed hover:border-[var(--ant-primary-6)] border-[var(--ant-basic-4)] bg-[var(--ant-basic-1)] rounded-lg p-6 cursor-pointer transition-all ease-in-out duration-300 flex flex-col items-center"
              onClick={onFolderSelection}
            >
              <Image
                src="/folders.svg"
                alt="folder"
                className="size-9  mb-5"
                width={36}
                height={36}
              />
              <p className="text-sm text-[var(--ant-basic-6)]">{t("selectScopeDesc")}</p>
            </div>

            <div className="space-y-0 border rounded-lg transition-all">
              {applicationScope.scopeType === "all" && (
                <div
                  className="p-3 cursor-pointer flex items-center justify-between gap-3 border-b"
                // onClick={() => onScopeTypeChange("all")}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-[30px] flex items-center justify-center ">
                      <Image
                        src="/other-type.svg"
                        alt="file"
                        width={20}
                        height={24}
                      />
                    </div>
                    <div>
                      <h4 className="font-medium text-[13px]">{t("allAssets")}</h4>
                      <p className="text-xs text-[var(--ant-basic-5)]">{t("allAssetsDesc")}</p>
                    </div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onScopeTypeChange("specific")
                          }}
                          className="h-8 w-8 p-0 hover:text-[var(--ant-danger-6)]"
                        >
                          <Trash />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("removeFolder")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}

              {applicationScope.selectedFolders.map((folder, index) => (
                <div
                  key={folder.slug}
                  className={cn(
                    "p-3 cursor-pointer flex items-center justify-between border-b",
                    index === applicationScope.selectedFolders.length - 1 && "border-b-0"
                  )}
                  onClick={() => dispatchMuseDAMClientAction("goto", { url: `/home/folder/${folder.slug.replace('/f', '')}` })}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-[30px] flex items-center justify-center">
                      <Image
                        src="/folder.svg"
                        alt="folder"
                        width={22.5}
                        height={19}
                      />
                    </div>
                    <div>
                      <h4 className="font-medium text-[13px]">{folder.name}</h4>
                      <p className="text-xs text-[var(--ant-basic-5)]">{t("currentAndNewAssets")}</p>
                    </div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFolder(folder.slug);
                          }}
                          className="h-8 w-8 p-0 hover:text-[var(--ant-danger-6)]"
                        >
                          <Trash />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("removeFolder")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))}
            </div>

            <div className="flex gap-3 text-[var(--ant-basic-5)] text-[13px]">
              {t("onlySelectedScope")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
