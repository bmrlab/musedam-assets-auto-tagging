export interface TagNode {
  id?: number;
  slug: string | null;
  name: string;
  verb?: "create" | "update" | "delete";
  children: TagNode[];
  isDeleted?: boolean;
  isEditing?: boolean;
  originalName?: string;
  tempId?: string; // 用于新创建的标签的临时ID
  sort?: number; // 排序字段
}

export interface TagRecord {
  id: number;
  description: string;
  materialCount: number;
  name: string;
  parentId: number;
}

export type SearchTagData = {
  tag: TagRecord;
  parent?: SearchTagData;
};
