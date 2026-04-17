"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spin } from "@/components/ui/spin";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BatchCreateTagsProvider,
  parseTextToNameChildList,
  useBatchCreateTagsContext,
} from "../context/BatchCreateTagsContext";
import { TagBatchEditor } from "./TagBatchEditor";

interface AiCreateModalProps {
  visible: boolean;
  setVisible: (visible: boolean) => void;
  onSuccess?: () => void;
}

type CloseConfirmReason = "generating" | "notApplied" | null;

// （已移除字符串手动替换）提示词直接使用 next-intl 占位变量格式化

// 内部组件，使用 Context
const AiCreateModalInner = ({ visible, setVisible, onSuccess }: AiCreateModalProps) => {
  const t = useTranslations("TagsPage");
  const tAI = useTranslations("AiCreateModal");
  const tManual = useTranslations("TagsPage.ManualCreateModal");
  const [isCreating, setIsCreating] = useState(false);
  // 行业类型选项 - 根据设计稿调整
  const industryValues = [
    "general",
    "ecommerce",
    "fmcg",
    "beauty",
    "fashion",
    "electronics",
    "automotive",
    "interior",
    "luxury",
    "gaming",
    "jewelry",
    "theme-park",
  ] as const;
  type IndustryKey = (typeof industryValues)[number];
  const industryIcons: Record<IndustryKey, string> = {
    general: "🌐",
    ecommerce: "🛒",
    fmcg: "🛍️",
    beauty: "💄",
    fashion: "🧥",
    electronics: "📱",
    automotive: "🚘",
    interior: "🪑",
    luxury: "👜",
    gaming: "🎮",
    jewelry: "💍",
    "theme-park": "🎡",
  };
  const industryOptions = industryValues.map((value) => ({
    value,
    icon: industryIcons[value],
    label: tAI(`industry.${value}.label`),
    prompt: tAI(`industry.${value}.prompt`),
  }));
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [otherDescription, setOtherDescription] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isPromptModified, setIsPromptModified] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<string>("");
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locale = useLocale();
  // const [selectedLanguage, setSelectedLanguage] = useState<"zh-CN" | "en-US">("zh-CN");

  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeConfirmReason, setCloseConfirmReason] = useState<CloseConfirmReason>(null);

  // 控制行业下拉的展开/收起（选择具体行业后收起，“其他”保持展开）
  const [industrySelectOpen, setIndustrySelectOpen] = useState(false);

  // 使用提取的 Hook
  const { handleAddTags } = useBatchCreateTagsContext();

  const stopPolling = () => {
    if (pollingTimerRef.current !== null) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  };

  const pollJobStatus = (jobId: number) => {
    stopPolling();
    pollingTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags/generate-tag-tree/jobs/${jobId}`, {
          credentials: "same-origin",
        });
        const data = await res.json() as {
          success: boolean;
          message?: string;
          data?: { jobId: number; status: string; result?: { text?: string; error?: string } };
        };

        if (!data.success) {
          setIsGenerating(false);
          toast.error(t("AiCreateModal.generateFailed") + ": " + (data.message ?? "查询任务失败"));
          return;
        }

        const { status, result } = data.data!;

        if (status === "completed") {
          setIsGenerating(false);
          setGeneratedResult((result?.text ?? "").trim());
        } else if (status === "failed") {
          setIsGenerating(false);
          toast.error(t("AiCreateModal.generateFailed") + ": " + (result?.error ?? "生成失败，请重试"));
        } else {
          // pending / processing -> 继续轮询
          pollJobStatus(jobId);
        }
      } catch (error) {
        console.error("polling error:", error);
        // 网络抖动时继续轮询，不终止
        pollJobStatus(jobId);
      }
    }, 2000);
  };

  const handleGenerate = async () => {
    if (!selectedIndustry && !isOtherSelected && !customPrompt.trim()) {
      return;
    }

    stopPolling();
    setIsGenerating(true);
    setGeneratedResult("");

    try {
      // 组装提示词：将行业预设、其它描述与用户输入合并
      const selectedOption = industryOptions.find((o) => o.value === selectedIndustry);
      const industryPreset = selectedOption?.prompt?.trim() ?? "";
      const industryLabel = isOtherSelected ? tAI("other") : (selectedOption?.label?.trim() ?? "");
      const otherDesc = isOtherSelected ? otherDescription.trim() : "";
      const customPromptTrimmed = customPrompt.trim();
      const mergedSegments = [
        industryLabel && `${t("AiCreateModal.selectedIndustry")} ${industryLabel}`,
        industryPreset,
        otherDesc,
        customPromptTrimmed,
      ].filter((segment): segment is string => Boolean(segment));

      // 去重后再拼接，避免行业预设和自定义输入重复导致 prompt 过长
      const mergedUserContext = Array.from(new Set(mergedSegments)).join("\n");

      const finalPrompt = tAI("tagTreePrompt.template", {
        userContext: (mergedUserContext || "").trim() || tAI("none"),
      });

      // 提交任务（秒级返回 jobId，不等待 LLM）
      const submitRes = await fetch("/api/tags/generate-tag-tree/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt, lang: locale }),
        credentials: "same-origin",
      });

      const submitData = await submitRes.json() as { success: boolean; message?: string; data?: { jobId: number } };
      if (!submitData.success || !submitData.data?.jobId) {
        throw new Error(submitData.message ?? "提交任务失败");
      }

      const jobId = submitData.data.jobId;
      // 开始轮询
      pollJobStatus(jobId);
    } catch (error) {
      console.error("AI generation submit error:", error);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      toast.error(t("AiCreateModal.generateFailed") + ": " + errorMessage);
      setIsGenerating(false);
    }
  };

  // 组件卸载时停止轮询
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const handleConfirm = async () => {
    // 解析生成的文本为标签结构
    const nameChildList = parseTextToNameChildList(generatedResult);

    if (nameChildList.length === 0) {
      toast.error(tAI("parseError"));
      return;
    }
    setIsCreating(true);
    try {
      // 使用提取的标签创建逻辑
      await handleAddTags(nameChildList);
    } finally {
      setIsCreating(false);
    }
  };

  const handleIndustrySelect = (industry: string) => {
    setSelectedIndustry(industry);
    setIsOtherSelected(false);
    setOtherDescription("");

    // 如果没有手动修改过prompt，则自动填充对应的prompt
    if (!isPromptModified) {
      const selectedOption = industryOptions.find((option) => option.value === industry);
      if (selectedOption) {
        setCustomPrompt(selectedOption.prompt ?? "");
      }
    }

    // 选择具体行业后收起下拉
    setIndustrySelectOpen(false);
  };

  const handleOtherSelect = () => {
    setSelectedIndustry("");
    setIsOtherSelected(true);

    // 选择“其他”时保持下拉展开，便于继续输入描述
    setIndustrySelectOpen(true);
  };

  // 获取选中行业的显示名称
  const getSelectedIndustryDisplay = () => {
    if (isOtherSelected) {
      return tAI("other");
    }
    if (selectedIndustry) {
      const option = industryOptions.find((opt) => opt.value === selectedIndustry);
      return option ? option.label : "";
    }
    return "";
  };

  const handlePromptChange = (value: string) => {
    setCustomPrompt(value);
    setIsPromptModified(!value.length ? false : true);
  };


  const closeModalDirectly = () => {
    stopPolling();
    setMode("preview");
    setVisible(false);
  };

  const requestCloseModal = () => {
    if (isGenerating) {
      setCloseConfirmReason("generating");
      setCloseConfirmOpen(true);
      return;
    }
    if (generatedResult.trim()) {
      setCloseConfirmReason("notApplied");
      setCloseConfirmOpen(true);
      return;
    }
    closeModalDirectly();
  };

  const handleConfirmClose = () => {
    setCloseConfirmOpen(false);
    setCloseConfirmReason(null);
    closeModalDirectly();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      requestCloseModal();
      return;
    }
    setVisible(true);
  };

  return (
    <>
      <Dialog open={visible} onOpenChange={handleOpenChange}>
        <DialogContent
          onPointerDownOutside={(event) => event.preventDefault()}
          className="w-[1200px] max-w-[90%] max-h-[calc(100%-80px)] h-[600px] overflow-hidden px-0 pb-0 gap-0 flex flex-col"
        >
          <DialogHeader className="border-b pb-4 px-5">
            <DialogTitle>{tAI("title")}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 h-full overflow-hidden flex gap-5 px-5">
          {/* 左侧：创建设置 */}
          <div className="flex-1 h-full flex flex-col gap-6 pb-[30px] pt-5">
            <Card className="p-0 border-none h-full bg-background">
              <CardContent className="px-[10px] space-y-4 h-full flex flex-col overflow-hidden">
                <h3 className="font-semibold">{tAI("createSettings")}</h3>
                {/* 提示信息 */}
                <p className="text-[13px] text-basic-8 border p-4 border-primary-6 bg-primary-1 rounded-[8px]">
                  {tAI("tip")}
                </p>
                {/* 语言选择 */}
                {/* <div className="space-y-2 flex items-center justify-between">
                  <Label htmlFor="language">{tAI("selectLanguage")}</Label>
                  <Select
                    value={selectedLanguage}
                    onValueChange={(value: "zh-CN" | "en-US") => setSelectedLanguage(value)}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <span>{selectedLanguage === "zh-CN" ? "🇨🇳" : "🇺🇸"}</span>
                          <span>{tAI(`language.${selectedLanguage}`)}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <button
                        onClick={() => setSelectedLanguage("zh-CN")}
                        className={`flex items-center w-full p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${selectedLanguage === "zh-CN" ? "border-primary-6 bg-primary-1" : ""}`}
                      >
                        <span>🇨🇳</span>
                        <span className="text-sm font-medium">{tAI("language.zh-CN")}</span>
                      </button>
                      <button
                        onClick={() => setSelectedLanguage("en-US")}
                        className={`flex items-center w-full p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${selectedLanguage === "en-US" ? "border-primary-6 bg-primary-1" : ""}`}
                      >
                        <span>🇺🇸</span>
                        <span className="text-sm font-medium">{tAI("language.en-US")}</span>
                      </button>
                    </SelectContent>
                  </Select>
                </div> */}

                {/* 行业选择 */}
                <div className="space-y-2 flex items-center justify-between">
                  <Label htmlFor="industry">{tAI("selectIndustry")}</Label>
                  <Select
                    open={industrySelectOpen}
                    onOpenChange={setIndustrySelectOpen}
                    value={isOtherSelected ? "other" : selectedIndustry}
                    onValueChange={(value) => {
                      if (value === "other") {
                        handleOtherSelect();
                      } else {
                        handleIndustrySelect(value);
                      }
                    }}
                  >
                    <SelectTrigger className="w-fit">
                      <SelectValue placeholder={t("pleaseSelect")}>
                        {getSelectedIndustryDisplay() && (
                          <div className="flex items-center gap-2">
                            <span>
                              {isOtherSelected
                                ? "👀"
                                : industryOptions.find((opt) => opt.value === selectedIndustry)
                                  ?.icon}
                            </span>
                            <span>{getSelectedIndustryDisplay()}</span>
                          </div>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[540px]" align="end">
                      <div className="p-4">
                        <div className="grid grid-cols-3 gap-3">
                          {industryOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => handleIndustrySelect(option.value)}
                              className={`flex items-center p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${selectedIndustry === option.value
                                ? "border-primary-6 bg-primary-1"
                                : ""
                                }`}
                            >
                              {option.icon}
                              <span className="text-sm font-medium text-start">{option.label}</span>
                            </button>
                          ))}
                          {/* 其它选项 */}
                          <button
                            onClick={handleOtherSelect}
                            className={`flex items-center p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${isOtherSelected ? "border-primary-6 bg-primary-1" : ""
                              }`}
                          >
                            👀
                            <span className="text-sm font-medium">{tAI("other")}</span>
                          </button>

                          {/* 其它选项的描述输入框 */}
                          {isOtherSelected && (
                            <Input
                              id="other-description"
                              type="text"
                              value={otherDescription}
                              onChange={(e) => setOtherDescription(e.target.value)}
                              placeholder={tAI("pleaseDescribe")}
                              className="col-span-2 h-full"
                            />
                          )}
                        </div>
                      </div>
                    </SelectContent>
                  </Select>
                </div>
                {/* 自定义提示词 */}
                <div className="space-y-2 flex-1 overflow-hidden">
                  <Label htmlFor="custom-prompt">{tAI("customPrompt")}</Label>
                  <Textarea
                    id="custom-prompt"
                    value={customPrompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    containerClassName="h-[calc(100%-40px)]"
                    className="resize-none h-full overflow-scroll"
                    placeholderContent={
                      <div className="space-y-3 text-sm text-basic-5">
                        <div>{tManual("PleaseCreateLabelsInTheFollowi")}</div>
                        <div className="space-y-1">
                          <div className="font-medium">{tManual("FormatInstructions")}</div>
                          <div className="flex items-start">
                            <span className="mr-2 whitespace-nowrap">{tManual("PrimaryTag")}</span>
                          </div>
                          <div className="flex items-start">
                            <span className="mr-2 whitespace-nowrap">{tManual("SecondaryTags")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span>{tManual("Label1")}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span>{tManual("Label2")}</span>
                          </div>
                        </div>
                      </div>
                    }
                  />
                </div>
                {/* 生成按钮 */}
                <Button
                  onClick={handleGenerate}
                  disabled={
                    (!selectedIndustry && !isOtherSelected && !customPrompt.trim()) ||
                    isGenerating
                  }
                  className="px-3 w-fit"
                >
                  {isGenerating ? tAI("generating") : tAI("generate")}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="bg-basic-3 h-full w-[1px]"></div>

          {/* 右侧：生成结果 */}
          <div className="flex-1 flex flex-col  pb-[30px] pt-5">
            <Card className="border-none p-0 h-full bg-background">
              <CardContent className="px-[10px] h-full flex flex-col gap-4">
                <h3 className="font-semibold">{tAI("result")}</h3>
                {(!generatedResult || isGenerating) ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="font-semibold text-lg mb-[6px] flex items-center gap-2">
                      {isGenerating && <Spin size="small" />}
                      {isGenerating ? tAI("generating") : tAI("waiting")}
                    </div>
                    <p className="text-[13px] text-basic-5">
                      {isGenerating ? tAI("aiAnalyzing") : tAI("pleaseSelectOrInput")}
                    </p>

                    <div
                      className={`text-sm  text-basic-6 flex flex-col items-start h-fit w-full bg-basic-1 rounded-[8px] p-4 mt-5 ${isGenerating ? "animate-pulse" : ""}`}
                    >
                      <span className="font-medium flex items-center gap-1">
                        <span className="text-xs">📋</span>
                        {tManual("FormatInstructions")}
                      </span>
                      <div className="mt-3">
                        <div className="flex items-start">
                          <span className="mr-2 whitespace-nowrap">{tManual("PrimaryTag")}</span>
                          <span className="text-[#52C41A] text-start">{tManual("PrimaryTagDescription")}</span>
                        </div>

                        <div className="flex items-start">
                          <span className="mr-2 whitespace-nowrap">{tManual("SecondaryTags")}</span>
                          <span className="text-[#1890FF] text-start">
                            {tManual("SecondaryTagDescription")}
                          </span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span>{tManual("Label1")}</span>
                          <div>
                            <span className="text-[#FAAD14]">{tManual("LabelDescription")}</span>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <span>{tManual("Label2")}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <TagBatchEditor
                        value={generatedResult}
                        mode={mode}
                        onModeChange={setMode}
                        onChange={(v) => {
                          setGeneratedResult(v)
                        }}
                        showModeSwitcher={true}
                      />
                    </div>
                    <Button
                      onClick={handleConfirm}
                      disabled={!generatedResult || isCreating}
                      className="w-fit"
                    >
                      {isCreating ? t("AiCreateModal.creating") : tAI("confirmApply")}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认关闭</AlertDialogTitle>
            <AlertDialogDescription>
              {closeConfirmReason === "generating"
                ? "标签树还在生成中，关闭后将停止当前页面轮询。确认关闭吗？"
                : "标签树已生成但尚未应用，确认关闭吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>确认关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// 主组件，提供 Context
export const AiCreateModal = ({ visible, setVisible, onSuccess }: AiCreateModalProps) => {
  return (
    <BatchCreateTagsProvider onSuccess={onSuccess} onClose={() => setVisible(false)}>
      <AiCreateModalInner visible={visible} setVisible={setVisible} onSuccess={onSuccess} />
    </BatchCreateTagsProvider>
  );
};
