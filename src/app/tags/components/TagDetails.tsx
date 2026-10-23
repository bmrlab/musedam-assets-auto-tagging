"use client";
import { EditIcon } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import { InfoIcon, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTagExtra } from "../actions";
import { localizeTagActionMessage } from "../tagActionMessage";
import { TagEditData, useTagEdit } from "../contexts/TagEditContext";
import { usePendingInboundTagRequired } from "../hooks/usePendingInboundTagRequired";
import { useTagVisibility } from "../hooks/useTagVisibility";
import { TagVisibilityDisplay } from "./TagVisibilityDisplay";

/** 详情面板中的开关项：标题 + 提示图标，下方小号开关 + 状态说明 */
function SwitchSetting({
  label,
  tooltip,
  checked,
  disabled,
  onCheckedChange,
  onText,
  offText,
  extra,
}: {
  label: string;
  tooltip: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  onText: string;
  offText: string;
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label className="text-sm font-medium">{label}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-basic-5 hover:text-basic-8">
                <InfoIcon className="text-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px] text-sm">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          size="sm"
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={label}
        />
        <span className="text-xs text-basic-5">{checked ? onText : offText}</span>
      </div>
      {extra}
    </div>
  );
}

// 组件Props类型
interface TagDetailsProps {
  selectedTag: { tag: AssetTag; level: number } | null;
  refreshTags: () => void;
  canEdit?: boolean;
}

export function TagDetails({ selectedTag, refreshTags, canEdit = false }: TagDetailsProps) {
  const t = useTranslations("TagsPage.TagDetails");
  const tRoot = useTranslations("TagsPage");
  const { getTagEditData, isTagEdited } = useTagEdit();
  const {
    showSwitch,
    required,
    loading: pendingRequiredLoading,
    handleToggle,
  } = usePendingInboundTagRequired(selectedTag);
  const visibility = useTagVisibility(selectedTag);

  // 本地表单状态
  const [formData, setFormData] = useState<TagEditData>({
    name: "",
    description: "",
    keywords: [],
    negativeKeywords: [],
    taggingEnabled: true,
    siblingsExclusive: false,
    requiredGroup: false,
  });

  // 编辑态
  const [editing, setIsEditing] = useState(false);
  const isEditing = canEdit && editing;
  useEffect(() => { if (!canEdit) setIsEditing(false); }, [canEdit]);

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
        taggingEnabled: tag.taggingEnabled,
        siblingsExclusive: extra.siblingsExclusive === true,
        requiredGroup: extra.requiredGroup === true,
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
        taggingEnabled: true,
        siblingsExclusive: false,
        requiredGroup: false,
      });
      setIsEditing(false);
    }
  }, [selectedTag?.tag.id, selectedTag?.tag, getTagEditData, getOriginalData]);

  // 更新表单字段
  const updateField = (field: keyof TagEditData, value: string | string[] | boolean) => {
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
              className="h-4 w-4 p-0 text-basic-5 hover:text-red-500 dark:hover:text-red-400"
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
            className="h-7 px-2 text-sm text-basic-5 border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50"
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
      <div className="w-[300px] shrink-0 bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
        <div className="border-b px-4 py-2 font-medium">{t("tagDetails")}</div>
        <div className="flex-1 overflow-y-scroll scrollbar-thin p-4">
          <p className="text-basic-5 text-center py-8 text-sm">{t("selectTagToView")}</p>
        </div>
      </div>
    );
  }

  // 检查是否被编辑过
  const hasChanges = selectedTag.tag.id ? isTagEdited(selectedTag.tag.id) : false;
  const hasChildTags = Array.isArray(
    (selectedTag.tag as AssetTag & { children?: AssetTag[] }).children,
  )
    ? ((selectedTag.tag as AssetTag & { children?: AssetTag[] }).children?.length ?? 0) > 0
    : false;
  const shouldShowRequiredSwitch = showSwitch && (hasChildTags || required);
  const handleVisibilitySelection = async () => {
    if (!canEdit) return;
    try {
      await visibility.selectAndSave(
        t.has("selectVisibleMembers")
          ? t("selectVisibleMembers")
          : "Select members who can view this tag",
      );
    } catch {
      toast.error(
        t.has("saveVisibilityFailed") ? t("saveVisibilityFailed") : "Failed to save tag visibility",
      );
    }
  };

  const handleStartEdit = () => {
    if (!canEdit) return;
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
    if (!canEdit) return;
    if (!selectedTag?.tag?.id) return;
    try {
      const res = await updateTagExtra(selectedTag.tag.id, {
        name: formData.name,
        description: formData.description,
        keywords: formData.keywords,
        negativeKeywords: formData.negativeKeywords,
        taggingEnabled: formData.taggingEnabled,
        // 互斥开关只对有子标签的分类有意义，叶子标签不提交，避免写入无意义字段
        ...(hasChildTags
          ? { siblingsExclusive: formData.siblingsExclusive, requiredGroup: formData.requiredGroup }
          : {}),
      });
      if (res.success) {
        toast.success(tRoot("saveSuccess"));
        refreshTags();
        setIsEditing(false);
      } else {
        toast.error(localizeTagActionMessage(res.message, tRoot) || tRoot("saveFailed"));
      }
    } catch (e) {
      toast.error(tRoot("saveFailed"));
    }
  };

  return (
    <div className="w-[300px] shrink-0 bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
      {/* 标题栏 */}
      <div className="border-b px-4 py-2 font-medium flex items-center justify-between">
        <span>{t("tagDetails")}</span>
        {canEdit && (!isEditing ? (
          <Button onClick={handleStartEdit} size="sm" variant="outline">
            <EditIcon className="size-[14px]" />
            {t("edit")}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleCancel} size="sm">
              {tRoot("cancel")}
            </Button>
            <Button onClick={handleSave} size="sm">
              {tRoot("saveChanges")}
            </Button>
          </div>
        ))}
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
              placeholder={t("tagNamePlaceholder")}
            />
          ) : (
            <div className="text-sm text-foreground/90 min-h-9 flex items-center px-3 py-2 border rounded-md bg-basic-1">
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
            <div className="text-sm text-foreground/90 whitespace-pre-wrap px-3 py-2 border rounded-md bg-basic-1 min-h-[80px]">
              {formData.description || "-"}
            </div>
          )}
        </div>

        {/* 开关区：入库必填 → AI 自动打标 → 子标签单选 → 必打标签组 */}
        {shouldShowRequiredSwitch && (
          <SwitchSetting
            label={t("requiredForInventoryEntry")}
            tooltip={t("requiredForInventoryEntryTooltip")}
            checked={required}
            disabled={!canEdit || pendingRequiredLoading}
            onCheckedChange={(checked) => { if (canEdit) void handleToggle(checked); }}
            onText={t("requiredForInventoryEntryOn")}
            offText={t("requiredForInventoryEntryOff")}
            extra={
              required && (
                <p className="text-xs leading-5 text-basic-5">
                  {t("requiredForInventoryEntryHint")}
                </p>
              )
            }
          />
        )}

        <SwitchSetting
          label={t("aiAutoTagging")}
          tooltip={t("aiAutoTaggingTooltip")}
          checked={formData.taggingEnabled}
          // TODO 增加二次确认弹窗
          onCheckedChange={(checked) => updateField("taggingEnabled", checked)}
          disabled={!isEditing}
          onText={t("aiAutoTaggingEnabled")}
          offText={t("aiAutoTaggingDisabled")}
        />

        {/* 子标签单选 / 必打标签组：仅对有子标签的分类显示 */}
        {hasChildTags && (
          <SwitchSetting
            label={t("siblingsExclusive")}
            tooltip={t("siblingsExclusiveTooltip")}
            checked={formData.siblingsExclusive}
            onCheckedChange={(checked) => updateField("siblingsExclusive", checked)}
            disabled={!isEditing}
            onText={t("siblingsExclusiveOn")}
            offText={t("siblingsExclusiveOff")}
          />
        )}

        {hasChildTags && (
          <SwitchSetting
            label={t("requiredGroup")}
            tooltip={t("requiredGroupTooltip")}
            checked={formData.requiredGroup}
            onCheckedChange={(checked) => updateField("requiredGroup", checked)}
            disabled={!isEditing}
            onText={t("requiredGroupOn")}
            offText={t("requiredGroupOff")}
          />
        )}

        {/* 匹配关键词 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-sm font-medium">{t("matchingKeywords")}</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-basic-5 hover:text-basic-8"
                  >
                    <InfoIcon className="text-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-sm">
                  <span className="font-medium">{t("matchingRule")}</span>
                  {t("matchingRuleDescription")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {isEditing ? (
            renderKeywordList("keywords", t("inputKeywords"))
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {formData.keywords.length > 0 ? (
                formData.keywords.map((keyword, index) => (
                  <div
                    key={index}
                    className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-sm"
                  >
                    <span>{keyword}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-basic-5">-</span>
              )}
            </div>
          )}
        </div>

        {/* 排除关键词 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Label className="text-sm font-medium">{t("excludeKeywords")}</Label>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-basic-5 hover:text-basic-8"
                    title={t("excludeKeywordsTooltip")}
                  >
                    <InfoIcon className="text-current" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-sm">
                  <span className="font-medium">{t("excludeRule")}</span>
                  {t("excludeRuleDescription")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {isEditing ? (
            renderKeywordList("negativeKeywords", t("inputKeywords"))
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {formData.negativeKeywords.length > 0 ? (
                formData.negativeKeywords.map((keyword, index) => (
                  <div
                    key={index}
                    className="inline-flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-sm"
                  >
                    <span>{keyword}</span>
                  </div>
                ))
              ) : (
                <span className="text-sm text-basic-5">-</span>
              )}
            </div>
          )}
        </div>

        {/* 只有一级标签可以配置可见范围，下级标签随一级 */}
        {visibility.canConfigure && (
          <TagVisibilityDisplay
            label={t.has("tagVisibilityRange") ? t("tagVisibilityRange") : "Tag visibility"}
            allMembersVisibleText={
              t.has("allMembersVisible") ? t("allMembersVisible") : "Visible to all members"
            }
            selection={visibility.selection}
            loading={visibility.loading}
            readOnly={!canEdit}
            onSelect={handleVisibilitySelection}
          />
        )}
      </div>
    </div>
  );
}
