"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import { Edit, Edit2, InfoIcon, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { TagEditData, useTagEdit } from "../contexts/TagEditContext";
import { updateTagExtra } from "../actions";
import { toast } from "sonner";
import { Tooltip } from "recharts";

// 组件Props类型
interface TagDetailsProps {
  selectedTag: { tag: AssetTag; level: number } | null;
  refreshTags: () => void
}

export function TagDetails({ selectedTag, refreshTags }: TagDetailsProps) {
  const t = useTranslations("TagsPage.TagDetails");
  const tRoot = useTranslations("TagsPage");
  const { getTagEditData, isTagEdited } = useTagEdit();

  // 本地表单状态
  const [formData, setFormData] = useState<TagEditData>({
    name: "",
    description: "",
    keywords: [],
    negativeKeywords: [],
  });

  // 编辑态
  const [isEditing, setIsEditing] = useState(false);

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
      setFormData(editedData || originalData);
      setIsEditing(false);
    } else {
      setFormData({
        name: "",
        description: "",
        keywords: [],
        negativeKeywords: [],
      });
      setIsEditing(false);
    }
  }, [selectedTag?.tag.id, selectedTag?.tag, getTagEditData, getOriginalData]);

  // 更新表单字段
  const updateField = (field: keyof TagEditData, value: string | string[]) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
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
            className="inline-flex items-center gap-1 bg-muted hover:bg-muted/80 rounded-md px-2 py-1 text-sm"
          >
            <span>{keyword}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
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
            className="h-7 px-2 text-sm text-muted-foreground border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50"
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

  const handleStartEdit = () => {
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (selectedTag?.tag) {
      const originalData = getOriginalData(selectedTag.tag);
      setFormData(originalData);
    }
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!selectedTag?.tag?.id) return;
    try {
      const res = await updateTagExtra(selectedTag.tag.id, {
        name: formData.name,
        description: formData.description,
        keywords: formData.keywords,
        negativeKeywords: formData.negativeKeywords,
      });
      if (res.success) {
        toast.success(tRoot("saveSuccess"));
        refreshTags()
        setIsEditing(false);
      } else {
        toast.error(res.message || tRoot("saveFailed"));
      }
    } catch (e) {
      toast.error(tRoot("saveFailed"));
    }
  };

  return (
    <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
      {/* 标题栏 */}
      <div className="border-b px-4 py-2 font-medium flex items-center justify-between">
        <span>{t("tagDetails")}</span>
        {!isEditing ? (
          <Button onClick={handleStartEdit}>
            <Edit />
            编辑
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleCancel}>{tRoot("cancel")}</Button>
            <Button onClick={handleSave}>{tRoot("saveChanges")}</Button>
          </div>
        )}
        {/* {hasChanges && (
          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{t("modified")}</span>
        )} */}
      </div>

      {/* 表单内容 */}
      <div className="flex-1 overflow-y-scroll scrollbar-thin space-y-6 p-4">
        {/* 标签名称 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("tagName")}</Label>
          {isEditing ? (
            <Input
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="海报设计"
            />
          ) : (
            <div className="text-sm text-foreground/90 min-h-9 flex items-center px-3 py-2 border rounded-md bg-muted/30">
              {formData.name || "-"}
            </div>
          )}
        </div>

        {/* 标签描述 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("tagDescription")}</Label>
          {isEditing ? (
            <Textarea
              value={formData.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder={t("tagDescriptionPlaceholder")}
              className="min-h-[80px] resize-none"
            />
          ) : (
            <div className="text-sm text-foreground/90 whitespace-pre-wrap px-3 py-2 border rounded-md bg-muted/30 min-h-[80px]">
              {formData.description || "-"}
            </div>
          )}
        </div>

        {/* AI自动打标 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">{t("aiAutoTagging")}</Label>
          <div className="flex items-center gap-2">
            <Switch defaultChecked disabled={!isEditing} />
            <span className="text-sm text-muted-foreground">{t("aiAutoTaggingEnabled")}</span>
          </div>
        </div>

        {/* 匹配关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("matchingKeywords")}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"

              title={t("matchingKeywordsTooltip")}
            >
              <InfoIcon />
            </Button>
          </div>
          {isEditing ? (
            renderKeywordList("keywords", t("inputKeywords"))
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {formData.keywords.length > 0 ? (
                formData.keywords.map((keyword, index) => (
                  <div key={index} className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-sm">
                    <span>{keyword}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">-</span>
              )}
            </div>
          )}
        </div>

        {/* 排除关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t("excludeKeywords")}</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title={t("excludeKeywordsTooltip")}
            >
              <InfoIcon />
            </Button>
          </div>
          {isEditing ? (
            renderKeywordList("negativeKeywords", t("inputKeywords"))
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {formData.negativeKeywords.length > 0 ? (
                formData.negativeKeywords.map((keyword, index) => (
                  <div key={index} className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-sm">
                    <span>{keyword}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">-</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
