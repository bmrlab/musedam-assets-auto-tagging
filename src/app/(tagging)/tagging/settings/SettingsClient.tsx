"use client";
import { dispatchMuseDAMClientAction } from "@/musedam/embed";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSettings } from "./actions";
import { AIRecognitionSection } from "./components/AIRecognitionSection";
import { ApplicationScopeSection } from "./components/ApplicationScopeSection";
import { GlobalSettingsSection } from "./components/GlobalSettingsSection";
import { MatchingStrategySection } from "./components/MatchingStrategySection";
import { SettingsHeader } from "./components/SettingsHeader";
import { TaggingModeSection } from "./components/TaggingModeSection";
import { SettingsData } from "./types";

interface SettingsClientProps {
  initialSettings: SettingsData;
}

export default function SettingsClient({ initialSettings }: SettingsClientProps) {
  const [isTaggingEnabled, setIsTaggingEnabled] = useState(initialSettings.isTaggingEnabled);
  const [taggingMode, setTaggingMode] = useState(initialSettings.taggingMode);
  const [recognitionMode, setRecognitionMode] = useState(initialSettings.recognitionMode);
  const [matchingStrategies, setMatchingStrategies] = useState(initialSettings.matchingStrategies);
  const [applicationScope, setApplicationScope] = useState(initialSettings.applicationScope);
  const [isPending, startTransition] = useTransition();
  const [hasChanges, setHasChanges] = useState(false);

  const handleStrategyChange = (strategy: keyof typeof matchingStrategies, checked: boolean) => {
    setMatchingStrategies((prev) => ({
      ...prev,
      [strategy]: checked,
    }));
    setHasChanges(true);
  };

  const handleSaveSettings = () => {
    startTransition(async () => {
      const settingsData: SettingsData = {
        isTaggingEnabled,
        taggingMode,
        recognitionMode,
        matchingStrategies,
        applicationScope,
      };

      const result = await updateSettings(settingsData);

      if (result.success) {
        toast.success("设置已保存");
        setHasChanges(false);
      } else {
        toast.error("保存设置失败");
      }
    });
  };

  const handleTaggingEnabledChange = (enabled: boolean) => {
    setIsTaggingEnabled(enabled);
    setHasChanges(true);
  };

  const handleTaggingModeChange = (mode: "direct" | "review") => {
    setTaggingMode(mode);
    setHasChanges(true);
  };

  const handleRecognitionModeChange = (mode: "precise" | "balanced" | "broad") => {
    setRecognitionMode(mode);
    setHasChanges(true);
  };

  const handleScopeTypeChange = (scopeType: "all" | "specific") => {
    setApplicationScope((prev) => ({
      ...prev,
      scopeType,
      selectedFolders: scopeType === "specific" ? prev.selectedFolders : [],
    }));
    setHasChanges(true);
  };

  const handleFolderSelection = async () => {
    try {
      const res = await dispatchMuseDAMClientAction("folder-selector-modal-open", {});
      console.log("文件夹选择结果:", res);
      if (res && typeof res === "object") {
        const { allMaterials, selectedFolders } = res;
        console.log("allMaterials:", allMaterials, "selectedFolders:", selectedFolders);

        if (allMaterials) {
          setApplicationScope((prev) => ({
            ...prev,
            scopeType: "all",
            selectedFolders: [],
          }));
        } else if (
          selectedFolders &&
          Array.isArray(selectedFolders) &&
          selectedFolders.length > 0
        ) {
          setApplicationScope((prev) => {
            const newScope = {
              ...prev,
              scopeType: "specific" as const,
              selectedFolders: selectedFolders,
            };
            console.log("新的应用范围状态:", newScope);
            return newScope;
          });
        }
        setHasChanges(true);
      } else {
        console.log("没有选择文件夹或返回格式不正确");
      }
    } catch (error) {
      console.error("选择文件夹失败:", error);
      toast.error("选择文件夹失败");
    }
  };

  const handleRemoveFolder = (folderId: string) => {
    setApplicationScope((prev) => ({
      ...prev,
      selectedFolders: prev.selectedFolders.filter((folder) => folder.id !== folderId),
    }));
    setHasChanges(true);
  };

  useEffect(() => {
    console.log("Application scope state changed:", applicationScope);
    console.log("Selected folders count:", applicationScope.selectedFolders.length);
  }, [applicationScope]);

  return (
    <div className="space-y-8 p-6 max-w-5xl mx-auto">
      <SettingsHeader hasChanges={hasChanges} isPending={isPending} onSave={handleSaveSettings} />

      <GlobalSettingsSection
        isTaggingEnabled={isTaggingEnabled}
        onTaggingEnabledChange={handleTaggingEnabledChange}
      />

      <TaggingModeSection taggingMode={taggingMode} onTaggingModeChange={handleTaggingModeChange} />

      <MatchingStrategySection
        matchingStrategies={matchingStrategies}
        onStrategyChange={handleStrategyChange}
      />

      <AIRecognitionSection
        recognitionMode={recognitionMode}
        onRecognitionModeChange={handleRecognitionModeChange}
      />

      <ApplicationScopeSection
        applicationScope={applicationScope}
        onFolderSelection={handleFolderSelection}
        onRemoveFolder={handleRemoveFolder}
        onScopeTypeChange={handleScopeTypeChange}
      />
    </div>
  );
}
