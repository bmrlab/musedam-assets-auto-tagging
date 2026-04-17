"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spin } from "@/components/ui/spin";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ServerActionResult } from "@/lib/serverAction";
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
  const locale = useLocale()
  // const [selectedLanguage, setSelectedLanguage] = useState<"zh-CN" | "en-US">("zh-CN");

  const [mode, setMode] = useState<"preview" | "edit">("preview");

  // 控制行业下拉的展开/收起（选择具体行业后收起，“其他”保持展开）
  const [industrySelectOpen, setIndustrySelectOpen] = useState(false);

  // 使用提取的 Hook
  const { handleAddTags } = useBatchCreateTagsContext();

  const handleGenerate = async () => {
    if (!selectedIndustry && !isOtherSelected && !customPrompt.trim()) {
      return;
    }

    setIsGenerating(true);
    try {
      // 组装提示词：将行业预设、其它描述与用户输入合并
      const selectedOption = industryOptions.find((o) => o.value === selectedIndustry);
      const industryPreset = selectedOption?.prompt?.trim() ?? "";
      const industryLabel = isOtherSelected ? tAI("other") : (selectedOption?.label?.trim() ?? "");
      const otherDesc = isOtherSelected ? otherDescription.trim() : "";
      const mergedUserContext = [
        industryLabel && `${t("AiCreateModal.selectedIndustry")} ${industryLabel}`,
        industryPreset,
        otherDesc,
        customPrompt.trim(),
      ]
        .filter(Boolean)
        .join("\n");

      const finalPrompt = tAI("tagTreePrompt.template", {
        userContext: (mergedUserContext || "").trim() || tAI("none"),
      });

      const apiRes = await fetch("/api/tags/generate-tag-tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: finalPrompt, lang: locale }),
        credentials: "same-origin",
      });

      const ct = apiRes.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(
          "服务器返回了非 JSON（常见于网关超时或代理改写响应），请稍后重试或联系运维检查反代超时与缓冲设置",
        );
      }

      let resp: ServerActionResult<{ text: string; input: string }>;
      try {
        resp = (await apiRes.json()) as ServerActionResult<{ text: string; input: string }>;
      } catch {
        throw new Error("无法解析服务器 JSON 响应");
      }

      if (!apiRes.ok) {
        if (!resp.success) {
          throw new Error(resp.message);
        }
        throw new Error(`请求失败（HTTP ${apiRes.status}）`);
      }
      if (!resp.success) {
        throw new Error(resp.message || "生成失败");
      }

      setGeneratedResult(resp.data.text.trim());
    } catch (error) {
      console.error("AI generation error:", error);
      console.error(
        "AI generation error stack:",
        error instanceof Error ? error.stack : "No stack",
      );
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      toast.error(t("AiCreateModal.generateFailed") + ": " + errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

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


  const handleClose = () => {
    setMode("preview");
    setVisible(false);
  };

  return (
    <Dialog open={visible} onOpenChange={handleClose}>
      <DialogContent className="w-[1200px] max-w-[90%] max-h-[calc(100%-80px)] h-[600px] overflow-hidden px-0 pb-0 gap-0 flex flex-col">
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
