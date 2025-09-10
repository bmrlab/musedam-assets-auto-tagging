"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { TagEditData, useTagEdit } from "../contexts/TagEditContext";

// 组件Props类型
interface TagDetailsProps {
  selectedTag: { tag: AssetTag; level: number } | null;
}

export function TagDetails({ selectedTag }: TagDetailsProps) {
  const t = useTranslations("TagsPage.TagDetails");
  const { getTagEditData, updateTagData, isTagEdited } = useTagEdit();

  // 本地表单状态
  const [formData, setFormData] = useState<TagEditData>({
    name: "",
    description: "",
    keywords: [],
    negativeKeywords: [],
  });

  // 关键词输入状态
  const [keywordsInputValue, setKeywordsInputValue] = useState("");
  const [showKeywordsInput, setShowKeywordsInput] = useState(false);
  const [negativeKeywordsInputValue, setNegativeKeywordsInputValue] = useState("");
  const [showNegativeKeywordsInput, setShowNegativeKeywordsInput] = useState(false);

  // 获取标签的extra数据
  const getTagExtra = useCallback((tag: AssetTag): AssetTagExtra => {
    try {
      return (tag.extra as AssetTagExtra) || {};
    } catch {
      return {};
    }
  }, []);

  // 获取原始数据
  const getOriginalData = useCallback(
    (tag: AssetTag): TagEditData => {
      const extra = getTagExtra(tag);
      return {
        name: tag.name,
        description: extra.description || "",
        keywords: extra.keywords || [],
        negativeKeywords: extra.negativeKeywords || [],
      };
    },
    [getTagExtra],
  );

  // 当选中标签变化时，更新表单数据
  useEffect(() => {
    if (selectedTag?.tag.id) {
      const editedData = getTagEditData(selectedTag.tag.id);
      const originalData = getOriginalData(selectedTag.tag);

      // 如果有编辑数据，使用编辑数据；否则使用原始数据
      setFormData(editedData || originalData);
    } else {
      // 没有选中标签时重置
      setFormData({
        name: "",
        description: "",
        keywords: [],
        negativeKeywords: [],
      });
    }
  }, [selectedTag?.tag.id, selectedTag?.tag, getTagEditData, getOriginalData]);

  // 更新表单字段
  const updateField = (field: keyof TagEditData, value: string | string[]) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);

    // 同时更新Context中的数据
    if (selectedTag?.tag.id) {
      updateTagData(selectedTag.tag.id, newFormData);
    }
  };

  // 添加关键词
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addKeyword = (type: "keywords" | "negativeKeywords") => {
    updateField(type, [...formData[type], ""]);
  };

  // 更新关键词
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateKeyword = (type: "keywords" | "negativeKeywords", index: number, value: string) => {
    const newKeywords = formData[type].map((item, i) => (i === index ? value : item));
    updateField(type, newKeywords);
  };

  // 删除关键词
  const removeKeyword = (type: "keywords" | "negativeKeywords", index: number) => {
    const newKeywords = formData[type].filter((_, i) => i !== index);
    updateField(type, newKeywords);
  };

  // 渲染关键词列表（inline标签形式）
  const renderKeywordList = (type: "keywords" | "negativeKeywords", placeholder: string) => {
    const isKeywordsType = type === "keywords";
    const inputValue = isKeywordsType ? keywordsInputValue : negativeKeywordsInputValue;
    const setInputValue = isKeywordsType ? setKeywordsInputValue : setNegativeKeywordsInputValue;
    const showInput = isKeywordsType ? showKeywordsInput : showNegativeKeywordsInput;
    const setShowInput = isKeywordsType ? setShowKeywordsInput : setShowNegativeKeywordsInput;

    const handleAddTag = () => {
      if (inputValue.trim()) {
        updateField(type, [...formData[type], inputValue.trim()]);
        setInputValue("");
        setShowInput(false);
      }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTag();
      } else if (e.key === "Escape") {
        setInputValue("");
        setShowInput(false);
      }
    };

    return (
      <div className="flex flex-wrap gap-1.5">
        {formData[type].map((keyword, index) => (
          <div
            key={index}
            className="inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 text-sm"
          >
            <span>{keyword}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-gray-500 hover:text-red-500"
              onClick={() => removeKeyword(type, index)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {showInput ? (
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            onBlur={handleAddTag}
            placeholder={placeholder}
            className="h-7 w-24 text-sm"
            autoFocus
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-sm text-gray-500 border border-dashed border-gray-300 hover:border-gray-400"
            onClick={() => setShowInput(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            {t("add")}
          </Button>
        )}
      </div>
    );
  };

  // 没有选中标签时的空状态
  if (!selectedTag) {
    return (
      <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
        <div className="border-b px-4 py-2 font-medium">{t("tagDetails")}</div>
        <div className="flex-1 overflow-y-scroll scrollbar-thin p-4">
          <p className="text-muted-foreground text-center py-8">{t("selectTagToView")}</p>
        </div>
      </div>
    );
  }

  // 检查是否被编辑过
  const hasChanges = selectedTag.tag.id ? isTagEdited(selectedTag.tag.id) : false;

  return (
    <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
      {/* 标题栏 */}
      <div className="border-b px-4 py-2 font-medium flex items-center justify-between">
        <span>{t("tagDetails")}</span>
        {hasChanges && (
          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{t("modified")}</span>
        )}
      </div>

      {/* 表单内容 */}
      <div className="flex-1 overflow-y-scroll scrollbar-thin space-y-6 p-4">
        {/* 标签名称 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("tagName")}</Label>
          <Input
            value={formData.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="海报设计"
          />
        </div>

        {/* 标签描述 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("tagDescription")}</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder={t("tagDescriptionPlaceholder")}
            className="min-h-[80px] resize-none"
          />
        </div>

        {/* AI自动打标 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("aiAutoTagging")}</Label>
          <div className="flex items-center gap-2">
            <Switch defaultChecked />
            <span className="text-sm text-gray-600">{t("aiAutoTaggingEnabled")}</span>
          </div>
        </div>

        {/* 匹配关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("matchingKeywords")}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500"
              title={t("matchingKeywordsTooltip")}
            >
              ℹ️
            </Button>
          </div>
          {renderKeywordList("keywords", t("inputKeywords"))}
        </div>

        {/* 排除关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("excludeKeywords")}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500"
              title={t("excludeKeywordsTooltip")}
            >
              ℹ️
            </Button>
          </div>
          {renderKeywordList("negativeKeywords", t("inputKeywords"))}
        </div>
      </div>
    </div>
  );
}
