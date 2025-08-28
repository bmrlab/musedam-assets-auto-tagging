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
import { toast } from "sonner";
import { updateTagExtra } from "../actions";

export function TagDetails({
  selectedTag,
  onTagUpdated,
}: {
  selectedTag: { tag: AssetTag; level: number } | null;
  onTagUpdated?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState({
    name: "",
    description: "",
    keywords: [] as string[],
    negativeKeywords: [] as string[],
  });

  // 解析extra字段
  const getTagExtra = useCallback((tag: AssetTag): AssetTagExtra => {
    try {
      return (tag.extra as AssetTagExtra) || {};
    } catch {
      return {};
    }
  }, []);

  // 初始化编辑数据
  useEffect(() => {
    if (selectedTag) {
      const extra = getTagExtra(selectedTag.tag);
      setEditData({
        name: selectedTag.tag.name,
        description: extra.description || "",
        keywords: extra.keywords || [],
        negativeKeywords: extra.negativeKeywords || [],
      });
      setIsEditing(false);
    }
  }, [selectedTag, getTagExtra]);

  const handleSave = async () => {
    if (!selectedTag?.tag.id) return;

    setIsSaving(true);
    try {
      const result = await updateTagExtra(selectedTag.tag.id, editData);
      if (result.success) {
        toast.success("标签信息已更新");
        setIsEditing(false);
        onTagUpdated?.();
      } else {
        toast.error(result.message || "更新失败");
      }
    } catch (error) {
      console.error("Update error:", error);
      toast.error("更新时发生错误");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (selectedTag) {
      const extra = getTagExtra(selectedTag.tag);
      setEditData({
        name: selectedTag.tag.name,
        description: extra.description || "",
        keywords: extra.keywords || [],
        negativeKeywords: extra.negativeKeywords || [],
      });
    }
    setIsEditing(false);
  };

  const addKeyword = (type: "keywords" | "negativeKeywords") => {
    setEditData((prev) => ({
      ...prev,
      [type]: [...prev[type], ""],
    }));
  };

  const updateKeyword = (type: "keywords" | "negativeKeywords", index: number, value: string) => {
    setEditData((prev) => ({
      ...prev,
      [type]: prev[type].map((item, i) => (i === index ? value : item)),
    }));
  };

  const removeKeyword = (type: "keywords" | "negativeKeywords", index: number) => {
    setEditData((prev) => ({
      ...prev,
      [type]: prev[type].filter((_, i) => i !== index),
    }));
  };

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

  const { tag } = selectedTag;
  const extra = getTagExtra(tag);

  return (
    <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
      <div className="border-b px-4 py-2 font-medium flex items-center justify-between">
        <span>标签详情</span>
        {!isEditing && tag.id && (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            编辑
          </Button>
        )}
      </div>

      <div
        className="flex-1 overflow-y-scroll scrollbar-thin space-y-6 p-4 cursor-pointer"
        onClick={() => !isEditing && tag.id && setIsEditing(true)}
      >
        {/* 标签名称 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">标签名称</Label>
          {isEditing ? (
            <Input
              value={editData.name}
              onChange={(e) => setEditData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="海报设计"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="text-sm font-medium bg-gray-50 p-2 rounded border">{tag.name}</div>
          )}
        </div>

        {/* 标签描述 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">标签描述</Label>
          {isEditing ? (
            <Textarea
              value={editData.description}
              onChange={(e) => setEditData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="选填，添加标签描述可帮助 AI 更好地理解标签的应用场景"
              className="min-h-[80px] resize-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border min-h-[80px]">
              {extra.description || "选填，添加标签描述可帮助 AI 更好地理解标签的应用场景"}
            </div>
          )}
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
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) {
                  addKeyword("keywords");
                } else {
                  setIsEditing(true);
                }
              }}
            >
              ℹ️
            </Button>
          </div>
          <div className="space-y-2">
            {isEditing ? (
              <>
                {editData.keywords.map((keyword, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={keyword}
                      onChange={(e) => updateKeyword("keywords", index, e.target.value)}
                      placeholder="输入关键词"
                      className="flex-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeKeyword("keywords", index);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    addKeyword("keywords");
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  新增
                </Button>
              </>
            ) : (
              <div className="space-y-1">
                {extra.keywords?.map((keyword, index) => (
                  <div
                    key={index}
                    className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs mr-1 mb-1"
                  >
                    {keyword}
                  </div>
                ))}
                {(!extra.keywords || extra.keywords.length === 0) && (
                  <div className="text-sm text-gray-400">暂无关键词</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 排除关键词 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">排除关键词</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-blue-500"
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) {
                  addKeyword("negativeKeywords");
                } else {
                  setIsEditing(true);
                }
              }}
            >
              ℹ️
            </Button>
          </div>
          <div className="space-y-2">
            {isEditing ? (
              <>
                {editData.negativeKeywords.map((keyword, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={keyword}
                      onChange={(e) => updateKeyword("negativeKeywords", index, e.target.value)}
                      placeholder="输入关键词"
                      className="flex-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeKeyword("negativeKeywords", index);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    addKeyword("negativeKeywords");
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  新增
                </Button>
              </>
            ) : (
              <div className="space-y-1">
                {extra.negativeKeywords?.map((keyword, index) => (
                  <div
                    key={index}
                    className="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs mr-1 mb-1"
                  >
                    {keyword}
                  </div>
                ))}
                {(!extra.negativeKeywords || extra.negativeKeywords.length === 0) && (
                  <div className="text-sm text-gray-400">暂无排除关键词</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 编辑模式底部按钮 */}
      {isEditing && (
        <div className="border-t p-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
            className="flex-1"
          >
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="flex-1">
            {isSaving ? "保存中..." : "保存"}
          </Button>
        </div>
      )}
    </div>
  );
}
