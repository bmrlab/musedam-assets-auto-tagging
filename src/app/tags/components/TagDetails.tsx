"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TagEditData, useTagEdit } from "../contexts/TagEditContext";

// 组件Props类型
interface TagDetailsProps {
  selectedTag: { tag: AssetTag; level: number } | null;
}

export function TagDetails({ selectedTag }: TagDetailsProps) {
  const { getTagEditData, updateTagData, isTagEdited } = useTagEdit();

  // 本地表单状态
  const [formData, setFormData] = useState<TagEditData>({
    name: "",
    description: "",
    keywords: [],
    negativeKeywords: [],
  });

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
  const addKeyword = (type: "keywords" | "negativeKeywords") => {
    updateField(type, [...formData[type], ""]);
  };

  // 更新关键词
  const updateKeyword = (type: "keywords" | "negativeKeywords", index: number, value: string) => {
    const newKeywords = formData[type].map((item, i) => (i === index ? value : item));
    updateField(type, newKeywords);
  };

  // 删除关键词
  const removeKeyword = (type: "keywords" | "negativeKeywords", index: number) => {
    const newKeywords = formData[type].filter((_, i) => i !== index);
    updateField(type, newKeywords);
  };

  // 渲染关键词列表
  const renderKeywordList = (type: "keywords" | "negativeKeywords", placeholder: string) => (
    <>
      {formData[type].map((keyword, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={keyword}
            onChange={(e) => updateKeyword(type, index, e.target.value)}
            placeholder={placeholder}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-500"
            onClick={() => removeKeyword(type, index)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={() => addKeyword(type)}>
        <Plus className="h-4 w-4 mr-1" />
        新增
      </Button>
    </>
  );

  // 没有选中标签时的空状态
  if (!selectedTag) {
    return (
      <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
        <div className="border-b px-4 py-2 font-medium">标签详情</div>
        <div className="flex-1 overflow-y-scroll scrollbar-thin p-4">
          <p className="text-muted-foreground text-center py-8">请选择一个标签查看详情</p>
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
        <span>标签详情</span>
        {hasChanges && (
          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">已修改</span>
        )}
      </div>

      {/* 表单内容 */}
      <div className="flex-1 overflow-y-scroll scrollbar-thin space-y-6 p-4">
        {/* 标签名称 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">标签名称</Label>
          <Input
            value={formData.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="海报设计"
          />
        </div>

        {/* 标签描述 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">标签描述</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="选填，添加标签描述可帮助 AI 更好地理解标签的应用场景"
            className="min-h-[80px] resize-none"
          />
        </div>

        {/* AI自动打标 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">AI 自动打标</Label>
          <div className="flex items-center gap-2">
            <Switch defaultChecked />
            <span className="text-sm text-gray-600">已启用，允许 AI 识别此标签</span>
          </div>
        </div>

        {/* 匹配关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">匹配关键词</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500"
              onClick={() => addKeyword("keywords")}
            >
              ℹ️
            </Button>
          </div>
          <div className="space-y-2">{renderKeywordList("keywords", "输入关键词")}</div>
        </div>

        {/* 排除关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">排除关键词</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500"
              onClick={() => addKeyword("negativeKeywords")}
            >
              ℹ️
            </Button>
          </div>
          <div className="space-y-2">{renderKeywordList("negativeKeywords", "输入关键词")}</div>
        </div>
      </div>
    </div>
  );
}
