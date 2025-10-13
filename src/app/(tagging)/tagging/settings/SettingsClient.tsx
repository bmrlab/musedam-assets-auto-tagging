"use client";
import { TaggingSettingsData } from "@/app/(tagging)/types";
import { dispatchMuseDAMClientAction, triggerTeamSettingsNotification } from "@/embed/message";
import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSettings } from "./actions";
import { AIRecognitionSection } from "./components/AIRecognitionSection";
import { ApplicationScopeSection } from "./components/ApplicationScopeSection";
import { GlobalSettingsSection } from "./components/GlobalSettingsSection";
import { MatchingStrategySection } from "./components/MatchingStrategySection";
import { TaggingModeSection } from "./components/TaggingModeSection";
import { TriggerTimingSection } from "./components/TriggerTimingSection";


interface SettingsClientProps {
  initialSettings: TaggingSettingsData;
}

export default function SettingsClient({ initialSettings }: SettingsClientProps) {
  const t = useTranslations("Tagging.Settings");
  const [isTaggingEnabled, setIsTaggingEnabled] = useState(initialSettings.isTaggingEnabled);
  const [taggingMode, setTaggingMode] = useState(initialSettings.taggingMode);
  const [recognitionAccuracy, setRecognitionAccuracy] = useState(
    initialSettings.recognitionAccuracy,
  );
  const [matchingSources, setMatchingSources] = useState(initialSettings.matchingSources);
  const [triggerTiming, setTriggerTiming] = useState(initialSettings.triggerTiming);
  const [applicationScope, setApplicationScope] = useState(initialSettings.applicationScope);
  const [isPending, setIsSaving] = useState(false);


  const handleSourceChange = (source: keyof typeof matchingSources, checked: boolean) => {
    setMatchingSources((prev) => ({
      ...prev,
      [source]: checked,
    }));
    handleSaveSettings();
  };

  const handleSaveSettings = async (overrides?: Partial<TaggingSettingsData>) => {
    if (isPending) {
      toast.message("正在保存，请稍后操作")
      return
    }
    setIsSaving(true)
    const settingsData: TaggingSettingsData = {
      isTaggingEnabled: overrides?.isTaggingEnabled ?? isTaggingEnabled,
      taggingMode: overrides?.taggingMode ?? taggingMode,
      recognitionAccuracy: overrides?.recognitionAccuracy ?? recognitionAccuracy,
      matchingSources: overrides?.matchingSources ?? matchingSources,
      triggerTiming: overrides?.triggerTiming ?? triggerTiming,
      applicationScope: overrides?.applicationScope ?? applicationScope,
    };

    try {
      const result = await updateSettings(settingsData);

      if (result.success) {
        toast.success(t("settingsSaved"));
      } else {
        toast.error(t("saveSettingsFailed"));
      }
    } catch (error) {
      toast.error((error as Error).message ?? t("saveSettingsFailed"));
    }
    setIsSaving(false)
  }

  const handleTaggingEnabledChange = (enabled: boolean) => {
    setIsTaggingEnabled(enabled);
    handleSaveSettings({ isTaggingEnabled: enabled });
  };

  const handleTaggingModeChange = (mode: "direct" | "review") => {
    setTaggingMode(mode);
    handleSaveSettings({ taggingMode: mode });
  };

  const handleRecognitionAccuracyChange = (accuracy: "precise" | "balanced" | "broad") => {
    setRecognitionAccuracy(accuracy);
    handleSaveSettings({ recognitionAccuracy: accuracy });
  };

  const handleAutoRealtimeChange = (enabled: boolean) => {
    const next = { ...triggerTiming, autoRealtimeTagging: enabled };
    setTriggerTiming(next);
    handleSaveSettings({ triggerTiming: next });
  };

  const handleManualTriggerChange = async (enabled: boolean) => {
    const next = { ...triggerTiming, manualTriggerTagging: enabled };
    setTriggerTiming(next);
    await handleSaveSettings({ triggerTiming: next });
    // 通知父窗口团队设置已更新
    triggerTeamSettingsNotification();
  };

  const handleScheduledChange = (enabled: boolean) => {
    const next = { ...triggerTiming, scheduledTagging: enabled };
    setTriggerTiming(next);
    handleSaveSettings({ triggerTiming: next });
  };

  const handleScopeTypeChange = (scopeType: "all" | "specific") => {
    const next = {
      ...applicationScope,
      scopeType,
      selectedFolders: scopeType === "specific" ? applicationScope.selectedFolders : [],
    } as typeof applicationScope;
    setApplicationScope(next);
    handleSaveSettings({ applicationScope: next });
  };

  const handleFolderSelection = async () => {
    try {
      const res = await dispatchMuseDAMClientAction("folder-selector-modal-open", {
        initialSelectedFolders: applicationScope.selectedFolders?.map((item) => ({
          id: Number(item.slug.replace("f/", "")),
          name: item.name,
        })),
        allMaterials: applicationScope.scopeType === "all",
      });
      if (!res) {
        return;
      }
      const { allMaterials, selectedFolders } = res;
      // console.log("allMaterials:", allMaterials, "selectedFolders:", selectedFolders);
      // if (allMaterials) {
      //   setApplicationScope((prev) => ({
      //     ...prev,
      //     scopeType: "all",
      //     selectedFolders: [],
      //   }));
      // } else if (selectedFolders && Array.isArray(selectedFolders) && selectedFolders.length > 0) {
      //   setApplicationScope((prev) => {
      //     const scopeType:"all" | "specific" =  allMaterials ? "all" : "specific"
      //     const newScope = {
      //       ...prev,
      //       scopeType:scopeType,
      //       selectedFolders: selectedFolders.map((folder) => ({
      //         slug: idToSlug("assetFolder", folder.id),
      //         name: folder.name,
      //       })),
      //     };
      //     console.log(t("newApplicationScope"), newScope);
      //     return newScope;
      // });
      // }

      const scopeType: "all" | "specific" = allMaterials ? "all" : "specific";
      const newScope = {
        ...applicationScope,
        scopeType: scopeType,
        selectedFolders: selectedFolders.map((folder) => ({
          slug: idToSlug("assetFolder", new MuseDAMID(folder.id)),
          name: folder.name,
        })),
      };
      setApplicationScope(newScope);
      handleSaveSettings({ applicationScope: newScope });
    } catch (error) {
      toast.error(t("selectFoldersFailed"));
    }
  };

  const handleRemoveFolder = (folderSlug: string) => {
    const next = {
      ...applicationScope,
      selectedFolders: applicationScope.selectedFolders.filter((folder) => folder.slug !== folderSlug),
    };
    setApplicationScope(next);
    handleSaveSettings({ applicationScope: next });
  };


  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between h-[32px]">
        <h1 className="text-sm font-medium">{t("title")}</h1>
      </div>

      <GlobalSettingsSection
        isTaggingEnabled={isTaggingEnabled}
        onTaggingEnabledChange={handleTaggingEnabledChange}
      />

      <TaggingModeSection taggingMode={taggingMode} onTaggingModeChange={handleTaggingModeChange} />

      <AIRecognitionSection
        recognitionAccuracy={recognitionAccuracy}
        onRecognitionAccuracyChange={handleRecognitionAccuracyChange}
      />

      <MatchingStrategySection
        matchingSources={matchingSources}
        onSourceChange={handleSourceChange}
      />


      <h1 className="text-sm font-medium mt-[30px]">{t("AdvancedSettings.title")}</h1>
      <TriggerTimingSection
        autoRealtimeTagging={triggerTiming.autoRealtimeTagging}
        manualTriggerTagging={triggerTiming.manualTriggerTagging}
        scheduledTagging={triggerTiming.scheduledTagging}
        onAutoRealtimeChange={handleAutoRealtimeChange}
        onManualTriggerChange={handleManualTriggerChange}
        onScheduledChange={handleScheduledChange}
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
