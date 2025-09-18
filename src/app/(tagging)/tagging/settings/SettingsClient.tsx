"use client";
import { TaggingSettingsData } from "@/app/(tagging)/types";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSettings } from "./actions";
import { AIRecognitionSection } from "./components/AIRecognitionSection";
import { ApplicationScopeSection } from "./components/ApplicationScopeSection";
import { GlobalSettingsSection } from "./components/GlobalSettingsSection";
import { MatchingStrategySection } from "./components/MatchingStrategySection";
import { SettingsHeader } from "./components/SettingsHeader";
import { TaggingModeSection } from "./components/TaggingModeSection";

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
  const [applicationScope, setApplicationScope] = useState(initialSettings.applicationScope);
  const [isPending, startTransition] = useTransition();
  const [hasChanges, setHasChanges] = useState(false);

  const handleSourceChange = (source: keyof typeof matchingSources, checked: boolean) => {
    setMatchingSources((prev) => ({
      ...prev,
      [source]: checked,
    }));
    setHasChanges(true);
  };

  const handleSaveSettings = () => {
    startTransition(async () => {
      const settingsData: TaggingSettingsData = {
        isTaggingEnabled,
        taggingMode,
        recognitionAccuracy,
        matchingSources,
        applicationScope,
      };

      const result = await updateSettings(settingsData);

      if (result.success) {
        toast.success(t("settingsSaved"));
        setHasChanges(false);
      } else {
        toast.error(t("saveSettingsFailed"));
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

  const handleRecognitionAccuracyChange = (accuracy: "precise" | "balanced" | "broad") => {
    setRecognitionAccuracy(accuracy);
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
      const res = await dispatchMuseDAMClientAction("folder-selector-modal-open", {
        initialSelectedFolders: applicationScope.selectedFolders?.map((item) => ({
          id: item.slug.replace('f/', ''),
          name: item.name,
        })),
        allMaterials: applicationScope.scopeType === "all",
      });
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

      setApplicationScope((prev) => {
        const scopeType: "all" | "specific" = allMaterials ? "all" : "specific"
        const newScope = {
          ...prev,
          scopeType: scopeType,
          selectedFolders: selectedFolders.map((folder) => ({
            slug: idToSlug("assetFolder", folder.id),
            name: folder.name,
          })),
        };
        console.log(t("newApplicationScope"), newScope);
        return newScope;
      });
      setHasChanges(true);
    } catch (error) {
      console.error(t("selectFoldersFailed"), error);
      toast.error(t("selectFoldersFailed"));
    }
  };

  const handleRemoveFolder = (folderSlug: string) => {
    setApplicationScope((prev) => ({
      ...prev,
      selectedFolders: prev.selectedFolders.filter((folder) => folder.slug !== folderSlug),
    }));
    setHasChanges(true);
  };

  useEffect(() => {
    console.log("Application scope state changed:", applicationScope);
    console.log(t("selectedFoldersCount"), applicationScope.selectedFolders.length);
  }, [applicationScope, t]);

  return (
    <div className="space-y-3">
      <SettingsHeader hasChanges={hasChanges} isPending={isPending} onSave={handleSaveSettings} />

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

      <ApplicationScopeSection
        applicationScope={applicationScope}
        onFolderSelection={handleFolderSelection}
        onRemoveFolder={handleRemoveFolder}
        onScopeTypeChange={handleScopeTypeChange}
      />
    </div>
  );
}
