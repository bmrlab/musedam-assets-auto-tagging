"use client";
import { cn } from "@/lib/utils";
import { TagNode } from "../types";
import { TagColumn } from "./TagColumn";
import { SmartTagsContent } from "./SmartTags";
import { useTranslations } from "next-intl";

interface ThreeTagListProps {
    title?: string
    // 标签数据
    list1: TagNode[];
    list2: TagNode[];
    list3: TagNode[];

    // 总数
    total1: number;
    total2: number;
    total3: number;

    // 选中状态
    selectedLevel1Id?: string | null;
    selectedLevel2Id?: string | null;
    selectedLevel3Id?: string | null;

    // 回调函数
    onSelectLevel1?: (nodeId: string) => void;
    onSelectLevel2?: (nodeId: string) => void;
    onSelectLevel3?: (nodeId: string) => void;

    // 编辑相关回调
    onEdit?: (nodeId: string, newName: string) => Promise<boolean>;
    onStartEdit?: (nodeId: string) => void;
    onCancelEdit?: (nodeId: string) => void;
    onDelete?: (nodeId: string) => void;
    onRestore?: (nodeId: string) => void;
    onAddTag?: (level: 1 | 2 | 3) => void;

    // 工具函数
    getNodeId?: (node: TagNode) => string;
    hasDetailChanges?: (tagId: number) => boolean;

    // 配置选项
    showAdd?: boolean;
    showAiTags?: boolean;
    type?: "index" | "id";

    // 样式
    className?: string;
    canEdit?: boolean
}

export function ThreeTagList({
    list1,
    list2,
    list3,
    total1,
    total2,
    total3,
    selectedLevel1Id,
    selectedLevel2Id,
    selectedLevel3Id,
    onSelectLevel1,
    onSelectLevel2,
    onSelectLevel3,
    onEdit,
    onStartEdit,
    onCancelEdit,
    onDelete,
    onRestore,
    onAddTag,
    getNodeId = (node: TagNode) => node.id ? node.id.toString() : node.tempId!,
    hasDetailChanges,
    showAdd = true,
    showAiTags = true,
    className,
    canEdit, title
}: ThreeTagListProps) {
    const t = useTranslations("TagsPage");

    // 检查是否可以添加标签
    const canAddLevel2 = selectedLevel1Id && selectedLevel1Id !== "-1";
    const canAddLevel3 = selectedLevel2Id;

    // 获取选中的节点
    const selectedLevel1 = selectedLevel1Id ? list1.find(tag => getNodeId(tag) === selectedLevel1Id) : null;
    const selectedLevel2 = selectedLevel2Id ? list2.find(tag => getNodeId(tag) === selectedLevel2Id) : null;

    return (
        <div className={cn("flex-1 bg-background border h-full rounded-md overflow-hidden flex flex-col", className)}>
            {title && <div className="border-b px-4 py-2 font-medium">{title}</div>}
            <div className="grid grid-cols-3 [&>div+div]:border-l flex-1 overflow-hidden">
                {/* 第一列 - 标签组 */}
                <TagColumn
                    title={t("tagGroup")}
                    tags={list1}
                    level={1}
                    selectedId={selectedLevel1Id}
                    canAdd={showAdd}
                    emptyMessage={canEdit ? t("noTagGroups") : ""}
                    onAddTag={onAddTag || (() => { })}
                    onSelectTag={onSelectLevel1}
                    onEdit={onEdit || (async () => false)}
                    onStartEdit={onStartEdit || (() => { })}
                    onCancelEdit={onCancelEdit || (() => { })}
                    onDelete={onDelete || (() => { })}
                    onRestore={onRestore || (() => { })}
                    getNodeId={getNodeId}
                    hasDetailChanges={hasDetailChanges}
                    canEdit={canEdit}
                    totalCount={total1}
                    showAiTags={showAiTags}
                />

                {/* 第二列 - 标签 */}
                {selectedLevel1Id === "-1" ? (
                    <div className="col-span-2 flex flex-col items-stretch overflow-hidden">
                        <SmartTagsContent />
                    </div>
                ) : (
                    <>
                        <TagColumn
                            title={t("tag")}
                            tags={list2}
                            level={2}
                            selectedId={selectedLevel2Id}
                            canAdd={showAdd && !!canAddLevel2 && !!selectedLevel1 && !selectedLevel1.isDeleted}
                            emptyMessage={!selectedLevel1 ? "" : t("noTags")}
                            onAddTag={onAddTag || (() => { })}
                            onSelectTag={onSelectLevel2}
                            onEdit={onEdit || (async () => false)}
                            onStartEdit={onStartEdit || (() => { })}
                            onCancelEdit={onCancelEdit || (() => { })}
                            onDelete={onDelete || (() => { })}
                            onRestore={onRestore || (() => { })}
                            getNodeId={getNodeId}
                            hasDetailChanges={hasDetailChanges}
                            canEdit={canEdit}
                            totalCount={total2}
                        />

                        {/* 第三列 - 标签 */}
                        <TagColumn
                            title={t("tag")}
                            tags={list3}
                            level={3}
                            selectedId={selectedLevel3Id}
                            canAdd={showAdd && !!canAddLevel3 && !!selectedLevel2 && !selectedLevel2.isDeleted}
                            emptyMessage={!selectedLevel2 ? "" : t("noTags")}
                            onAddTag={onAddTag || (() => { })}
                            onSelectTag={onSelectLevel3}
                            onEdit={onEdit || (async () => false)}
                            onStartEdit={onStartEdit || (() => { })}
                            onCancelEdit={onCancelEdit || (() => { })}
                            onDelete={onDelete || (() => { })}
                            onRestore={onRestore || (() => { })}
                            getNodeId={getNodeId}
                            hasDetailChanges={hasDetailChanges}
                            canEdit={canEdit}
                            totalCount={total3}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
