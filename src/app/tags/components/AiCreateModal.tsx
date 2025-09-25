"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spin } from "@/components/ui/spin";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { generateTagTreeByLLM } from "../actions";
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
    label: tAI(`industry.${value}.label` as any),
    prompt: tAI(`industry.${value}.prompt` as any),
  }));
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [otherDescription, setOtherDescription] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isPromptModified, setIsPromptModified] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<string>("");

  const [mode, setMode] = useState<"preview" | "edit">("edit");

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
        industryLabel && `行业类型：${industryLabel}`,
        industryPreset,
        otherDesc,
        customPrompt.trim(),
      ]
        .filter(Boolean)
        .join("\n");

      const finalPrompt = tAI("tagTreePrompt.template", {
        userContext: (mergedUserContext || "").trim() || tAI("none"),
      });
      // console.log("finalPrompt", finalPrompt);
      const resp = await generateTagTreeByLLM(finalPrompt);
      if (!resp.success) {
        throw new Error(resp.message || "生成失败");
      }
      // console.log("resp.data", resp.data);

      setGeneratedResult(resp.data.text.trim());
    } catch (error) {
      console.error(t("AiCreateModal.generateFailed"), error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleConfirm = async () => {
    // 解析生成的文本为标签结构
    const nameChildList = parseTextToNameChildList(generatedResult);
    console.log("nameChildList", nameChildList);
    if (nameChildList.length === 0) {
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
  };

  const handleOtherSelect = () => {
    setSelectedIndustry("");
    setIsOtherSelected(true);
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
    setSelectedIndustry("");
    setIsOtherSelected(false);
    setOtherDescription("");
    setCustomPrompt("");
    setIsPromptModified(false);
    setGeneratedResult("");
    setMode("edit");
    setVisible(false);
  };

  return (
    <Dialog open={visible} onOpenChange={handleClose}>
      <DialogContent className="w-[1200px] max-w-full max-h-[90%] overflow-hidden px-0 pb-0 gap-0">
        <DialogHeader className="border-b pb-4 px-5">
          <DialogTitle>{tAI("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex gap-5 px-5">
          {/* 左侧：创建设置 */}
          <div className="flex-1 flex flex-col gap-6 pb-[30px] pt-5">
            <Card className="p-0 border-none">
              <CardContent className="px-[10px]">
                <div className="space-y-4">
                  <h3 className="font-semibold">{tAI("createSettings")}</h3>
                  {/* 提示信息 */}
                  <p className="text-[13px] text-basic-8 border p-4 border-primary-6 bg-primary-1 rounded-[8px]">
                    {tAI("tip")}
                  </p>
                  {/* 行业选择 */}
                  <div className="space-y-2 flex items-center justify-between">
                    <Label htmlFor="industry">{tAI("selectIndustry")}</Label>
                    <Select
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
                        <SelectValue placeholder={t("selectTagGroupFirst")}>
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
                                className={`flex items-center p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${
                                  selectedIndustry === option.value
                                    ? "border-primary-6 bg-primary-1"
                                    : ""
                                }`}
                              >
                                {option.icon}
                                <span className="text-sm font-medium">{option.label}</span>
                              </button>
                            ))}
                            {/* 其它选项 */}
                            <button
                              onClick={handleOtherSelect}
                              className={`flex items-center p-3 gap-2 rounded-[8px] border transition-all hover:border-primary-6 ${
                                isOtherSelected ? "border-primary-6 bg-primary-1" : ""
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
                  <div className="space-y-2">
                    <Label htmlFor="custom-prompt">{tAI("customPrompt")}</Label>
                    <Textarea
                      id="custom-prompt"
                      value={customPrompt}
                      onChange={(e) => handlePromptChange(e.target.value)}
                      className="h-[296px] max-h-full resize-none"
                      placeholderContent={
                        <div className="space-y-3 text-sm text-basic-5">
                          <div>{tManual("PleaseCreateLabelsInTheFollowi")}</div>
                          <div className="space-y-1">
                            <div className="font-medium">{tManual("FormatInstructions")}</div>
                            <div className="flex items-start">
                              <span className="mr-2">{tManual("PrimaryTag")}</span>
                            </div>
                            <div className="flex items-start">
                              <span className="mr-2">{tManual("SecondaryTags")}</span>
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
                    className="px-3"
                  >
                    {isGenerating ? tAI("generating") : tAI("generate")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="bg-basic-3 h-full w-[1px]"></div>

          {/* 右侧：生成结果 */}
          <div className="flex-1 flex flex-col  pb-[30px] pt-5">
            <Card className="border-none p-0 h-full">
              <CardContent className="px-[10px] h-full flex flex-col gap-4">
                <h3 className="font-semibold">{tAI("result")}</h3>
                {!generatedResult ? (
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
                          <span className="mr-2">{tManual("PrimaryTag")}</span>
                          <span className="text-[#52C41A]"></span>
                        </div>

                        <div className="flex items-start">
                          <span className="mr-2">{tManual("SecondaryTags")}</span>
                          <span className="text-[#1890FF]"></span>
                        </div>

                        <div className="flex items-start gap-2">
                          <span>{tManual("Label1")}</span>
                          <div>
                            <span className="text-[#FAAD14]"></span>
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
