"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AssetTag } from "@/prisma/client";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchTeamTags, saveTagsTree, updateTagExtra } from "./actions";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { TagColumn } from "./components/TagColumn";
import { TagDetails } from "./components/TagDetails";
import { TagEditProvider, useTagEdit } from "./contexts/TagEditContext";
import { TagNode } from "./types";

interface TagsClientProps {
  initialTags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[];
}

function TagsClientInner({ initialTags }: TagsClientProps) {
  const { editedTags, clearAllEdits, hasAnyEdits } = useTagEdit();
  const [tagsTree, setTagsTree] = useState<TagNode[]>([]);
  const [originalTags, setOriginalTags] = useState<
    (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[]
  >([]);
  const [selectedLevel1Id, setSelectedLevel1Id] = useState<string | null>(null);
  const [selectedLevel2Id, setSelectedLevel2Id] = useState<string | null>(null);
  const [selectedLevel3Id, setSelectedLevel3Id] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nextTempId, setNextTempId] = useState(1);
  const [initialized, setInitialized] = useState(false);
  // 移除了 tagExtraChanges 状态，现在使用 Context

  // 获取节点的唯一标识符
  const getNodeId = (node: TagNode): string => {
    return node.id ? node.id.toString() : node.tempId!;
  };

  // 将 Prisma 数据转换为 TagNode 格式并按ID排序
  const convertToTagNodes = useCallback(
    (tags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[]): TagNode[] => {
      return tags
        .sort((a, b) => a.id - b.id) // 按ID排序
        .map((tag) => ({
          id: tag.id,
          slug: tag.slug,
          name: tag.name,
          originalName: tag.name,
          children: tag.children ? convertToTagNodes(tag.children) : [],
        }));
    },
    [],
  );

  // 设置默认选中状态
  const setDefaultSelection = useCallback(
    (tree: TagNode[]) => {
      if (tree.length > 0 && !initialized) {
        const firstLevel1 = tree[0];
        setSelectedLevel1Id(getNodeId(firstLevel1));

        if (firstLevel1.children.length > 0) {
          const firstLevel2 = firstLevel1.children[0];
          setSelectedLevel2Id(getNodeId(firstLevel2));

          if (firstLevel2.children.length > 0) {
            const firstLevel3 = firstLevel2.children[0];
            setSelectedLevel3Id(getNodeId(firstLevel3));
          }
        }
        setInitialized(true);
      }
    },
    [initialized],
  );

  useEffect(() => {
    const newTree = convertToTagNodes(initialTags);
    setTagsTree(newTree);
    setOriginalTags(initialTags);
    setDefaultSelection(newTree);
  }, [initialTags, convertToTagNodes, setDefaultSelection]);

  // 检查是否有变更
  const checkHasChanges = useCallback(
    (nodes: TagNode[]): boolean => {
      for (const node of nodes) {
        if (node.verb || node.isDeleted) return true;
        if (checkHasChanges(node.children)) return true;
      }
      // 检查是否有标签详情变更
      if (hasAnyEdits()) return true;
      return false;
    },
    [hasAnyEdits],
  );

  useEffect(() => {
    setHasChanges(checkHasChanges(tagsTree));
  }, [tagsTree, checkHasChanges]);

  // 根据ID查找节点
  const findNodeById = (nodes: TagNode[], nodeId: string): TagNode | null => {
    for (const node of nodes) {
      if (getNodeId(node) === nodeId) return node;
      const found = findNodeById(node.children, nodeId);
      if (found) return found;
    }
    return null;
  };

  // 查找节点的父节点和同级节点
  const findNodeContext = (
    nodes: TagNode[],
    targetId: string,
    parent: TagNode | null = null,
  ): { node: TagNode; parent: TagNode | null; siblings: TagNode[] } | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (getNodeId(node) === targetId) {
        return { node, parent, siblings: nodes };
      }
      const found = findNodeContext(node.children, targetId, node);
      if (found) return found;
    }
    return null;
  };

  // 递归更新标签树并保持排序
  const updateNodeInTree = (
    nodes: TagNode[],
    targetId: string,
    updater: (node: TagNode, siblings: TagNode[]) => TagNode | null,
  ): TagNode[] => {
    const result = nodes
      .map((node) => {
        if (getNodeId(node) === targetId) {
          return updater(node, nodes);
        }
        return {
          ...node,
          children: updateNodeInTree(node.children, targetId, updater),
        };
      })
      .filter(Boolean) as TagNode[];

    // 按ID排序，新建的标签（tempId）排在最后
    return result.sort((a, b) => {
      if (a.id && b.id) return a.id - b.id;
      if (a.id && !b.id) return -1;
      if (!a.id && b.id) return 1;
      return 0;
    });
  };

  // 获取当前显示的标签（包含已删除的，用于UI显示）
  const getVisibleTags = (tags: TagNode[]) => tags;

  // 获取选中的节点
  const selectedLevel1 = selectedLevel1Id ? findNodeById(tagsTree, selectedLevel1Id) : null;
  const selectedLevel2 = selectedLevel2Id ? findNodeById(tagsTree, selectedLevel2Id) : null;
  const selectedLevel3 = selectedLevel3Id ? findNodeById(tagsTree, selectedLevel3Id) : null;

  // 获取不同层级的标签
  const level1Tags = getVisibleTags(tagsTree);
  const level2Tags = selectedLevel1 ? getVisibleTags(selectedLevel1.children) : [];
  const level3Tags = selectedLevel2 ? getVisibleTags(selectedLevel2.children) : [];

  // 检查同级标签名是否重复
  const checkNameDuplicate = (name: string, siblings: TagNode[], excludeId?: string) => {
    return siblings.some(
      (tag) =>
        getNodeId(tag) !== excludeId &&
        !tag.isDeleted &&
        tag.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
  };

  // 添加标签
  const addTag = (level: 1 | 2 | 3) => {
    const tempId = `temp_${nextTempId}`;
    setNextTempId(nextTempId + 1);

    const newTag: TagNode = {
      slug: null,
      name: "",
      verb: "create",
      children: [],
      isEditing: true,
      tempId,
    };

    setTagsTree((tree) => {
      const sortTags = (tags: TagNode[]) => {
        return [...tags].sort((a, b) => {
          if (a.id && b.id) return a.id - b.id;
          if (a.id && !b.id) return -1;
          if (!a.id && b.id) return 1;
          return 0;
        });
      };

      if (level === 1) {
        return sortTags([...tree, newTag]);
      } else if (level === 2 && selectedLevel1Id) {
        return updateNodeInTree(tree, selectedLevel1Id, (node) => ({
          ...node,
          children: sortTags([...node.children, newTag]),
        }));
      } else if (level === 3 && selectedLevel2Id) {
        return updateNodeInTree(tree, selectedLevel2Id, (node) => ({
          ...node,
          children: sortTags([...node.children, newTag]),
        }));
      }
      return tree;
    });
  };

  // 更新标签名
  const updateTagName = (nodeId: string, newName: string): boolean => {
    const context = findNodeContext(tagsTree, nodeId);
    if (!context) return false;

    if (checkNameDuplicate(newName, context.siblings, nodeId)) {
      toast.error("标签名在同级中已存在");
      return false;
    }

    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => ({
        ...node,
        name: newName,
        verb: node.id ? (node.originalName !== newName ? "update" : undefined) : "create",
        isEditing: false,
      })),
    );
    return true;
  };

  // 开始编辑
  const startEdit = (nodeId: string) => {
    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => ({
        ...node,
        isEditing: true,
      })),
    );
  };

  // 取消编辑
  const cancelEdit = (nodeId: string) => {
    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => {
        if (node.verb === "create") {
          // 新创建的标签，直接删除
          return null;
        }
        return {
          ...node,
          name: node.originalName || node.name,
          isEditing: false,
          verb: undefined,
        };
      }),
    );
  };

  // 删除标签（标记删除）
  const deleteTag = (nodeId: string) => {
    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => {
        if (node.verb === "create") {
          // 新创建的标签直接移除
          return null;
        }
        return {
          ...node,
          isDeleted: true,
          verb: "delete",
        };
      }),
    );

    // 如果删除的是当前选中的标签，清除选择
    if (nodeId === selectedLevel1Id) {
      setSelectedLevel1Id(null);
      setSelectedLevel2Id(null);
      setSelectedLevel3Id(null);
    } else if (nodeId === selectedLevel2Id) {
      setSelectedLevel2Id(null);
      setSelectedLevel3Id(null);
    } else if (nodeId === selectedLevel3Id) {
      setSelectedLevel3Id(null);
    }
  };

  // 恢复删除
  const restoreTag = (nodeId: string) => {
    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => ({
        ...node,
        isDeleted: false,
        verb: undefined,
      })),
    );
  };

  // 保存所有变更
  const saveChanges = async () => {
    setIsSaving(true);
    try {
      // 1. 先保存标签详情变更
      if (editedTags.size > 0) {
        for (const [tagId, editData] of editedTags) {
          const result = await updateTagExtra(tagId, editData);
          if (!result.success) {
            toast.error(`保存标签详情失败: ${result.message}`);
            return;
          }
        }
      }

      // 2. 再保存标签树结构变更
      // 保存当前选中状态
      const currentLevel1 = selectedLevel1;
      const currentLevel2 = selectedLevel2;
      const currentLevel3 = selectedLevel3;

      const result = await saveTagsTree(tagsTree);
      if (result.success) {
        toast.success("所有变更保存成功");

        // 3. 清空所有编辑状态
        clearAllEdits();

        // 4. 刷新数据
        const refreshResult = await fetchTeamTags();
        if (refreshResult.success) {
          const newTree = convertToTagNodes(refreshResult.data.tags);
          setTagsTree(newTree);
          setOriginalTags(refreshResult.data.tags);

          // 尝试恢复选中状态
          if (currentLevel1) {
            const newLevel1 = newTree.find((tag) => tag.name === currentLevel1.name);
            if (newLevel1) {
              setSelectedLevel1Id(getNodeId(newLevel1));

              if (currentLevel2) {
                const newLevel2 = newLevel1.children.find((tag) => tag.name === currentLevel2.name);
                if (newLevel2) {
                  setSelectedLevel2Id(getNodeId(newLevel2));

                  if (currentLevel3) {
                    const newLevel3 = newLevel2.children.find(
                      (tag) => tag.name === currentLevel3.name,
                    );
                    if (newLevel3) {
                      setSelectedLevel3Id(getNodeId(newLevel3));
                    } else {
                      setSelectedLevel3Id(null);
                    }
                  }
                } else {
                  setSelectedLevel2Id(null);
                  setSelectedLevel3Id(null);
                }
              }
            } else {
              setSelectedLevel1Id(null);
              setSelectedLevel2Id(null);
              setSelectedLevel3Id(null);
            }
          }
        }
      } else {
        toast.error(result.message || "保存失败");
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error("保存时发生错误");
    } finally {
      setIsSaving(false);
    }
  };

  // 处理同步完成
  const handleSyncComplete = async () => {
    const refreshResult = await fetchTeamTags();
    if (refreshResult.success) {
      const newTree = convertToTagNodes(refreshResult.data.tags);
      setTagsTree(newTree);
      setOriginalTags(refreshResult.data.tags);
      setSelectedLevel1Id(null);
      setSelectedLevel2Id(null);
      setSelectedLevel3Id(null);
      setInitialized(false);
      setDefaultSelection(newTree);
    }
  };

  // 从原始标签中查找AssetTag
  const findOriginalTag = (
    tags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[],
    targetId: number,
  ): AssetTag | null => {
    for (const tag of tags) {
      if (tag.id === targetId) return tag;
      if (tag.children) {
        const found = findOriginalTag(tag.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  // 获取当前选中的标签信息
  const getSelectedTag = () => {
    let selectedNode: TagNode | null = null;
    let level = 0;

    if (selectedLevel3) {
      selectedNode = selectedLevel3;
      level = 3;
    } else if (selectedLevel2) {
      selectedNode = selectedLevel2;
      level = 2;
    } else if (selectedLevel1) {
      selectedNode = selectedLevel1;
      level = 1;
    }

    if (!selectedNode || !selectedNode.id) return null;

    const originalTag = findOriginalTag(originalTags, selectedNode.id);
    if (!originalTag) return null;

    return { tag: originalTag, level };
  };

  // 检查标签详情是否被编辑过
  const checkTagDetailChanges = useCallback((tagId: number): boolean => {
    return editedTags.has(tagId);
  }, [editedTags]);

  const TagsHeaderMenu = () => {
    return (
      <div className="bg-background border rounded-md p-2 flex justify-between items-center gap-3">
        <div className="flex items-center gap-4 flex-1 relative">
          <Input
            type="text"
            placeholder="搜索标签"
            className="w-full pl-10"
            // TODO: 实现搜索功能
          />
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
            <svg
              className="w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* AI自动打标签开关 */}
          <div className="flex items-center gap-2">
            <Switch />
            <span className="text-sm text-gray-600">AI 自动打标签</span>
          </div>
          <div className="flex items-center gap-2">
            <SyncConfirmDialog onSyncComplete={handleSyncComplete} />
            <Button
              onClick={saveChanges}
              disabled={!hasChanges || isSaving}
              variant="default"
              size="sm"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "保存中..." : "保存更改"}
            </Button>
          </div>
          <Button variant="outline" size="sm">
            <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
            AI 助手
          </Button>
          <Button variant="outline" size="sm">
            批量创建
          </Button>
        </div>
      </div>
    );
  };

  const TagMainColumns = () => {
    return (
      <div className="flex-1 bg-background border rounded-md overflow-hidden grid grid-cols-3 [&>div+div]:border-l">
        <TagColumn
          title="标签组"
          tags={level1Tags}
          level={1}
          selectedId={selectedLevel1Id}
          canAdd={true}
          emptyMessage="暂无标签组"
          onAddTag={addTag}
          onSelectTag={(nodeId) => {
            setSelectedLevel1Id(nodeId);
            setSelectedLevel2Id(null);
            setSelectedLevel3Id(null);
          }}
          onEdit={updateTagName}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onDelete={deleteTag}
          onRestore={restoreTag}
          getNodeId={getNodeId}
          hasDetailChanges={checkTagDetailChanges}
        />

        <TagColumn
          title="标签"
          tags={level2Tags}
          level={2}
          selectedId={selectedLevel2Id}
          canAdd={!!selectedLevel1 && !selectedLevel1.isDeleted}
          emptyMessage={!selectedLevel1 ? "请先选择标签组" : "暂无标签"}
          onAddTag={addTag}
          onSelectTag={(nodeId) => {
            setSelectedLevel2Id(nodeId);
            setSelectedLevel3Id(null);
          }}
          onEdit={updateTagName}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onDelete={deleteTag}
          onRestore={restoreTag}
          getNodeId={getNodeId}
          hasDetailChanges={checkTagDetailChanges}
        />

        <TagColumn
          title="标签"
          tags={level3Tags}
          level={3}
          selectedId={selectedLevel3Id}
          canAdd={!!selectedLevel2 && !selectedLevel2.isDeleted}
          emptyMessage={!selectedLevel2 ? "请先选择二级标签" : "暂无标签"}
          onAddTag={addTag}
          onSelectTag={(nodeId) => setSelectedLevel3Id(nodeId)}
          onEdit={updateTagName}
          onStartEdit={startEdit}
          onCancelEdit={cancelEdit}
          onDelete={deleteTag}
          onRestore={restoreTag}
          getNodeId={getNodeId}
          hasDetailChanges={checkTagDetailChanges}
        />
      </div>
    );
  };

  return (
    <div className="h-dvh min-w-[60rem] overflow-x-scroll scrollbar-thin flex flex-col items-stretch gap-4 p-4 bg-zinc-50">
      <TagsHeaderMenu />
      <div className="flex-1 overflow-hidden flex flex-row items-stretch gap-4">
        <TagMainColumns />
        <TagDetails selectedTag={getSelectedTag()} />
      </div>
    </div>
  );
}

// 主组件，用 Provider 包裹
export default function TagsClient({ initialTags }: TagsClientProps) {
  return (
    <TagEditProvider>
      <TagsClientInner initialTags={initialTags} />
    </TagEditProvider>
  );
}
