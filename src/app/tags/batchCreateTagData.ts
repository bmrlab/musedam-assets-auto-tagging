// 批量创建标签的数据结构（独立文件，避免 actions 与 merge 工具循环依赖）
export interface BatchCreateTagData {
  name: string;
  sort?: number;
  nameChildList?: BatchCreateTagData[];
}
