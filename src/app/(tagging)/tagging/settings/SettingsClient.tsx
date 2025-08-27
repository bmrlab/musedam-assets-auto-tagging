"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { dispatchMuseDAMClientAction } from "@/musedam/embed";
import { InfoIcon, Loader2Icon, SaveIcon, SettingsIcon, UserIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSettings } from "./actions";

import { SettingsData } from "./actions";

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

  const handleScopeTypeChange = (scopeType: "all" | "shared" | "specific") => {
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
          // 如果选择了全部素材
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
          // 如果选择了特定文件夹
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

  // Debug useEffect to monitor state changes
  useEffect(() => {
    console.log("Application scope state changed:", applicationScope);
    console.log("Selected folders count:", applicationScope.selectedFolders.length);
  }, [applicationScope]);

  return (
    <div className="space-y-8 p-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon className="size-6" />
          <h1 className="text-2xl font-bold">AI 打标设置</h1>
        </div>

        {/* Save Button */}
        {hasChanges && (
          <Button onClick={handleSaveSettings} disabled={isPending} className="gap-2">
            {isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {isPending ? "保存中..." : "保存设置"}
          </Button>
        )}
      </div>

      {/* Global Settings */}
      <Card>
        <CardHeader>
          <CardTitle>全局设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Tagging Switch */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">打标开关</h3>
            </div>
            <Switch checked={isTaggingEnabled} onCheckedChange={handleTaggingEnabledChange} />
          </div>

          <Separator />

          {/* Auto Tagging Engine */}
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

      {/* Tagging Mode */}
      <Card>
        <CardHeader>
          <CardTitle>打标模式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Direct Application */}
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all",
                taggingMode === "direct"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => handleTaggingModeChange("direct")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">直接应用</h3>
                <p className="text-sm text-muted-foreground">AI 打标直接应用到资产标签</p>
              </div>
            </div>

            {/* Review Mode */}
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all",
                taggingMode === "review"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => handleTaggingModeChange("review")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">审核模式</h3>
                <p className="text-sm text-muted-foreground">需人工审核后应用到资产标签</p>
              </div>
            </div>
          </div>

          {/* Recommendation Notice */}
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

      {/* Matching Strategy Selection */}
      <Card>
        <CardHeader>
          <CardTitle>匹配策略选择</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* File Path Matching */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  checked={matchingStrategies.filePath}
                  onCheckedChange={(checked) =>
                    handleStrategyChange("filePath", checked as boolean)
                  }
                />
                <div>
                  <h3 className="font-medium">文件类路径匹配</h3>
                  <p className="text-sm text-muted-foreground">
                    基于素材所在的文件类路径进行标签匹配
                  </p>
                </div>
              </div>
            </div>

            {/* Material Name Matching */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  checked={matchingStrategies.materialName}
                  onCheckedChange={(checked) =>
                    handleStrategyChange("materialName", checked as boolean)
                  }
                />
                <div>
                  <h3 className="font-medium">素材名称匹配</h3>
                  <p className="text-sm text-muted-foreground">分析文件名称中的关键信息进行匹配</p>
                </div>
              </div>
            </div>

            {/* Material Content Matching */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  checked={matchingStrategies.materialContent}
                  onCheckedChange={(checked) =>
                    handleStrategyChange("materialContent", checked as boolean)
                  }
                />
                <div>
                  <h3 className="font-medium">素材内容匹配</h3>
                  <p className="text-sm text-muted-foreground">AI 分析文件内容进行智能识别</p>
                </div>
              </div>
            </div>

            {/* Tag Keywords Matching */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  checked={matchingStrategies.tagKeywords}
                  onCheckedChange={(checked) =>
                    handleStrategyChange("tagKeywords", checked as boolean)
                  }
                />
                <div>
                  <h3 className="font-medium">标签关键词匹配</h3>
                  <p className="text-sm text-muted-foreground">基于现有关键词进行准确匹配</p>
                </div>
              </div>
            </div>

            {/* Multi-language Intelligent Matching */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  checked={matchingStrategies.multiLanguage}
                  onCheckedChange={(checked) =>
                    handleStrategyChange("multiLanguage", checked as boolean)
                  }
                />
                <div>
                  <h3 className="font-medium">多语言智能匹配</h3>
                  <p className="text-sm text-muted-foreground">支持多语言文义识别</p>
                  <div className="flex items-center gap-2 mt-2">
                    <UserIcon className="size-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">付费功能</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Recognition Settings */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <CardTitle>AI 识别设置</CardTitle>
          <InfoIcon className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Precise Mode */}
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all",
                recognitionMode === "precise"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => handleRecognitionModeChange("precise")}
            >
              <div className="text-center space-y-2">
                <h3 className="font-medium">精准模式</h3>
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  80-100% 置信度
                </div>
                <p className="text-xs text-muted-foreground">优先准确性，适合打标要求严格的场景</p>
              </div>
            </div>

            {/* Balanced Mode */}
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all relative",
                recognitionMode === "balanced"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => handleRecognitionModeChange("balanced")}
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

            {/* Broad Mode */}
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all",
                recognitionMode === "broad"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => handleRecognitionModeChange("broad")}
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

      {/* Application Scope Settings */}
      <Card>
        <CardHeader>
          <CardTitle>应用范围设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* AI Tagging Scope */}
          <div className="space-y-4">
            <h3 className="font-medium">AI 打标范围</h3>
            <div
              className="border-2 border-dashed border-primary rounded-lg p-6 cursor-pointer hover:bg-primary/5 transition-colors text-center"
              onClick={handleFolderSelection}
            >
              <div className="size-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                📁
              </div>
              <p className="text-sm text-muted-foreground">点击选择要启用 AI 自动打标的资产范围</p>
            </div>

            <div className="space-y-4">
              {/* All Materials - only show when selected */}
              {applicationScope.scopeType === "all" && (
                <div
                  className="border rounded-lg p-4 cursor-pointer transition-all flex items-center gap-3 border-primary bg-primary/5"
                  onClick={() => handleScopeTypeChange("all")}
                >
                  <div className="size-5 bg-muted rounded flex items-center justify-center">📁</div>
                  <div>
                    <h4 className="font-medium">全部素材</h4>
                    <p className="text-sm text-muted-foreground">资产库所有现有及新上传的素材</p>
                  </div>
                </div>
              )}

              {/* Selected Folders Display */}
              {applicationScope.selectedFolders.map((folder) => (
                <div
                  key={folder.id}
                  className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all flex items-center justify-between",
                    applicationScope.scopeType === "specific"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50",
                  )}
                  onClick={() => handleScopeTypeChange("specific")}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-5 bg-muted rounded flex items-center justify-center">
                      📁
                    </div>
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
                      handleRemoveFolder(folder.id);
                    }}
                    className="h-8 w-8 p-0"
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>

            {/* Notice */}
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
    </div>
  );
}
