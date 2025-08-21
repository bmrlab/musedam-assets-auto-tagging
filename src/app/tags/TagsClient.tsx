"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AssetTag } from "@/prisma/client";
import { Edit2, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchTeamTags, saveTagsTree } from "./actions";

interface TagNode {
  id?: number;
  name: string;
  verb?: "create" | "update" | "delete";
  children: TagNode[];
  isDeleted?: boolean;
  isEditing?: boolean;
  originalName?: string;
  tempId?: string; // 用于新创建的标签的临时ID
}

interface TagsClientProps {
  initialTags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[];
}

export default function TagsClient({ initialTags }: TagsClientProps) {
  const [tagsTree, setTagsTree] = useState<TagNode[]>([]);
  const [selectedLevel1Id, setSelectedLevel1Id] = useState<string | null>(null);
  const [selectedLevel2Id, setSelectedLevel2Id] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nextTempId, setNextTempId] = useState(1);
  const [initialized, setInitialized] = useState(false);

  // 获取节点的唯一标识符
  const getNodeId = (node: TagNode): string => {
    return node.id ? node.id.toString() : node.tempId!;
  };

  // 将 Prisma 数据转换为 TagNode 格式并按ID排序
  const convertToTagNodes = (tags: (AssetTag & { children?: any[] })[]): TagNode[] => {
    return tags
      .sort((a, b) => a.id - b.id) // 按ID排序
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        originalName: tag.name,
        children: tag.children ? convertToTagNodes(tag.children) : [],
      }));
  };

  // 设置默认选中状态
  const setDefaultSelection = (tree: TagNode[]) => {
    if (tree.length > 0 && !initialized) {
      const firstLevel1 = tree[0];
      setSelectedLevel1Id(getNodeId(firstLevel1));

      if (firstLevel1.children.length > 0) {
        const firstLevel2 = firstLevel1.children[0];
        setSelectedLevel2Id(getNodeId(firstLevel2));
      }
      setInitialized(true);
    }
  };

  useEffect(() => {
    const newTree = convertToTagNodes(initialTags);
    setTagsTree(newTree);
    setDefaultSelection(newTree);
  }, [initialTags]);

  // 检查是否有变更
  const checkHasChanges = (nodes: TagNode[]): boolean => {
    for (const node of nodes) {
      if (node.verb || node.isDeleted) return true;
      if (checkHasChanges(node.children)) return true;
    }
    return false;
  };

  useEffect(() => {
    setHasChanges(checkHasChanges(tagsTree));
  }, [tagsTree]);

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
  const updateTagName = (nodeId: string, newName: string) => {
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
    } else if (nodeId === selectedLevel2Id) {
      setSelectedLevel2Id(null);
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

  // 保存标签树
  const saveChanges = async () => {
    setIsSaving(true);
    try {
      // 保存当前选中状态
      const currentLevel1 = selectedLevel1;
      const currentLevel2 = selectedLevel2;

      const result = await saveTagsTree(tagsTree);
      if (result.success) {
        toast.success("标签保存成功");
        // 刷新数据
        const refreshResult = await fetchTeamTags();
        if (refreshResult.success) {
          const newTree = convertToTagNodes(refreshResult.data.tags);
          setTagsTree(newTree);

          // 尝试恢复选中状态
          if (currentLevel1) {
            const newLevel1 = newTree.find((tag) => tag.name === currentLevel1.name);
            if (newLevel1) {
              setSelectedLevel1Id(getNodeId(newLevel1));

              if (currentLevel2) {
                const newLevel2 = newLevel1.children.find((tag) => tag.name === currentLevel2.name);
                if (newLevel2) {
                  setSelectedLevel2Id(getNodeId(newLevel2));
                } else {
                  setSelectedLevel2Id(null);
                }
              }
            } else {
              setSelectedLevel1Id(null);
              setSelectedLevel2Id(null);
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

  // 标签项渲染组件
  const TagItem = ({
    tag,
    level,
    onSelect,
    isSelected = false,
  }: {
    tag: TagNode;
    level: number;
    onSelect?: () => void;
    isSelected?: boolean;
  }) => {
    const [editValue, setEditValue] = useState(tag.name);
    const nodeId = getNodeId(tag);

    const handleSave = () => {
      if (!editValue.trim()) {
        toast.error("标签名不能为空");
        return;
      }
      updateTagName(nodeId, editValue.trim());
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        setEditValue(tag.name);
        cancelEdit(nodeId);
      }
    };

    if (tag.isEditing) {
      return (
        <div className="flex items-center gap-2 p-2 border rounded">
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入标签名"
            className="flex-1"
            autoFocus
          />
          <Button size="sm" onClick={handleSave} disabled={!editValue.trim()}>
            <Save className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => cancelEdit(nodeId)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div
        className={cn("flex items-center justify-between p-2 rounded border transition-colors", {
          "bg-red-50 border-red-200 text-red-600 opacity-60": tag.isDeleted,
          "hover:bg-muted cursor-pointer": !tag.isDeleted,
          "bg-green-50 border-green-200": tag.verb === "create",
          "bg-blue-50 border-blue-200": tag.verb === "update",
          "bg-primary/10": isSelected && !tag.isDeleted,
        })}
        onClick={!tag.isDeleted ? onSelect : undefined}
      >
        <span className={tag.isDeleted ? "line-through" : ""}>
          {tag.name}
          {tag.verb === "create" && <span className="ml-1 text-xs text-green-600">(新建)</span>}
          {tag.verb === "update" && <span className="ml-1 text-xs text-blue-600">(已修改)</span>}
          {tag.isDeleted && <span className="ml-1 text-xs text-red-600">(将删除)</span>}
          {level < 3 && tag.children.length > 0 && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground px-1 rounded">
              {tag.children.filter((child) => !child.isDeleted).length}
            </span>
          )}
        </span>

        <div className="flex items-center gap-1">
          {tag.isDeleted ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                restoreTag(nodeId);
              }}
            >
              <Undo2 className="h-3 w-3" />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(nodeId);
                }}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTag(nodeId);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 操作栏 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">标签编辑</h1>
          <p className="text-muted-foreground">管理三级标签体系</p>
        </div>
        <Button
          onClick={saveChanges}
          disabled={!hasChanges || isSaving}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "保存中..." : "保存更改"}
        </Button>
      </div>

      {/* 三列标签编辑区域 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 第一列：一级标签 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">一级标签</CardTitle>
              <Button size="sm" onClick={() => addTag(1)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {level1Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">暂无标签</p>
            ) : (
              level1Tags.map((tag) => (
                <TagItem
                  key={getNodeId(tag)}
                  tag={tag}
                  level={1}
                  isSelected={selectedLevel1Id === getNodeId(tag)}
                  onSelect={() => {
                    setSelectedLevel1Id(getNodeId(tag));
                    setSelectedLevel2Id(null);
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* 第二列：二级标签 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">二级标签</CardTitle>
              <Button
                size="sm"
                onClick={() => addTag(2)}
                disabled={!selectedLevel1 || selectedLevel1.isDeleted}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedLevel1 ? (
              <p className="text-muted-foreground text-sm text-center py-4">请先选择一级标签</p>
            ) : level2Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">暂无标签</p>
            ) : (
              level2Tags.map((tag) => (
                <TagItem
                  key={getNodeId(tag)}
                  tag={tag}
                  level={2}
                  isSelected={selectedLevel2Id === getNodeId(tag)}
                  onSelect={() => setSelectedLevel2Id(getNodeId(tag))}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* 第三列：三级标签 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">三级标签</CardTitle>
              <Button
                size="sm"
                onClick={() => addTag(3)}
                disabled={!selectedLevel2 || selectedLevel2.isDeleted}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedLevel2 ? (
              <p className="text-muted-foreground text-sm text-center py-4">请先选择二级标签</p>
            ) : level3Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">暂无标签</p>
            ) : (
              level3Tags.map((tag) => <TagItem key={getNodeId(tag)} tag={tag} level={3} />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
