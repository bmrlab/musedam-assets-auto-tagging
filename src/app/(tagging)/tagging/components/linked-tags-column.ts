// 关联标签列在各特征库表格里固定宽度（表头与单元格一致）。
// 不能让列宽跟着内容走：LinkedTagsOverflow 按容器宽度决定显示几个标签 / 是否截断，
// table-auto 下列宽又由内容决定，两者互相依赖会逐帧收敛，看起来就是列"先宽后一点点缩窄"。
const LINKED_TAGS_COLUMN_WIDTH = "w-[260px] min-w-[260px] max-w-[260px]";

export const linkedTagsColumnHeaderClassName = `${LINKED_TAGS_COLUMN_WIDTH} px-4 py-0`;

export const linkedTagsColumnCellClassName = LINKED_TAGS_COLUMN_WIDTH;
