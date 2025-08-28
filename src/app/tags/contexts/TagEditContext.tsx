"use client";
import { createContext, useContext, useState, ReactNode } from "react";

// 标签编辑数据类型
export interface TagEditData {
  name: string;
  description: string;
  keywords: string[];
  negativeKeywords: string[];
}

// Context类型定义
interface TagEditContextType {
  // 所有标签的编辑状态 - tagId -> 编辑的数据
  editedTags: Map<number, TagEditData>;
  
  // 更新标签编辑数据
  updateTagData: (tagId: number, data: Partial<TagEditData>) => void;
  
  // 获取标签的编辑数据（如果没有编辑过则返回null）
  getTagEditData: (tagId: number) => TagEditData | null;
  
  // 检查标签是否被编辑过
  isTagEdited: (tagId: number) => boolean;
  
  // 清空所有编辑状态（保存后调用）
  clearAllEdits: () => void;
  
  // 检查是否有任何编辑
  hasAnyEdits: () => boolean;
}

// 创建Context
const TagEditContext = createContext<TagEditContextType | null>(null);

// Provider组件
export function TagEditProvider({ children }: { children: ReactNode }) {
  const [editedTags, setEditedTags] = useState<Map<number, TagEditData>>(new Map());

  const updateTagData = (tagId: number, data: Partial<TagEditData>) => {
    setEditedTags(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(tagId);
      
      if (existing) {
        // 更新现有数据
        newMap.set(tagId, { ...existing, ...data });
      } else {
        // 创建新的编辑数据（需要提供默认值）
        const defaultData: TagEditData = {
          name: "",
          description: "",
          keywords: [],
          negativeKeywords: [],
          ...data
        };
        newMap.set(tagId, defaultData);
      }
      
      return newMap;
    });
  };

  const getTagEditData = (tagId: number): TagEditData | null => {
    return editedTags.get(tagId) || null;
  };

  const isTagEdited = (tagId: number): boolean => {
    return editedTags.has(tagId);
  };

  const clearAllEdits = () => {
    setEditedTags(new Map());
  };

  const hasAnyEdits = (): boolean => {
    return editedTags.size > 0;
  };

  const value: TagEditContextType = {
    editedTags,
    updateTagData,
    getTagEditData,
    isTagEdited,
    clearAllEdits,
    hasAnyEdits,
  };

  return (
    <TagEditContext.Provider value={value}>
      {children}
    </TagEditContext.Provider>
  );
}

// Hook来使用Context
export function useTagEdit() {
  const context = useContext(TagEditContext);
  if (!context) {
    throw new Error("useTagEdit must be used within TagEditProvider");
  }
  return context;
}