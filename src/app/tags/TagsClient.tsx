"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTag } from "@/prisma/client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchTeamTags, saveSingleTagChange, saveTagsTree } from "./actions";
import { CreateModal } from "./components/CreateModal";
import { SearchResult } from "./components/SearchResult";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { TagDetails } from "./components/TagDetails";
import { ThreeTagList } from "./components/ThreeTagList";
import { TagEditProvider, useTagEdit } from "./contexts/TagEditContext";
import { SearchTagData, TagNode, TagRecord } from "./types";

interface TagsClientProps {
  initialTags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[];
}

function TagsClientInner({ initialTags }: TagsClientProps) {
  const t = useTranslations("TagsPage");
  // const { editedTags, clearAllEdits, hasAnyEdits } = useTagEdit();
  const { editedTags } = useTagEdit();
  const [tagsTree, setTagsTree] = useState<TagNode[]>([]);
  const [originalTags, setOriginalTags] = useState<
    (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[]
  >([]);
  const [selectedLevel1Id, setSelectedLevel1Id] = useState<string | null>(null);
  const [selectedLevel2Id, setSelectedLevel2Id] = useState<string | null>(null);
  const [selectedLevel3Id, setSelectedLevel3Id] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nextTempId, setNextTempId] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // 移除了 tagExtraChanges 状态，现在使用 Context

  // 获取节点的唯一标识符
  const getNodeId = useCallback((node: TagNode): string => {
    return node.id ? node.id.toString() : node.tempId!;
  }, []);

  // 搜索标签函数
  const searchTags = (tags: TagNode[], query: string): TagNode[] => {
    if (!query.trim()) return tags;

    const lowerQuery = query.toLowerCase().trim();

    return tags
      .filter((tag) => {
        // 检查当前标签名是否匹配
        const nameMatch = tag.name.toLowerCase().includes(lowerQuery);

        // 检查子标签是否有匹配
        const childrenMatch = searchTags(tag.children, query).length > 0;

        return nameMatch || childrenMatch;
      })
      .map((tag) => ({
        ...tag,
        children: searchTags(tag.children, query),
      }));
  };

  // 获取搜索结果
  const getSearchResults = (): TagNode[] => {
    if (!searchQuery.trim()) return tagsTree;
    return searchTags(tagsTree, searchQuery);
  };

  // 将搜索结果转换为SearchTagData格式
  const getSearchResultsAsData = (): SearchTagData[] => {
    if (!searchQuery.trim()) return [];

    const results: SearchTagData[] = [];

    const collectSearchResults = (nodes: TagNode[], parent?: SearchTagData) => {
      for (const node of nodes) {
        if (node.id) {
          // 从原始数据中查找对应的标签信息
          // const originalTag = findOriginalTag(originalTags, node.id);

          const tagRecord: TagRecord = {
            id: node.id,
            name: node.name,
            description: "", // AssetTag没有description字段
            materialCount: 0, // AssetTag没有materialCount字段，需要从其他地方获取
            parentId: parent?.tag.id || 0,
          };

          const searchData: SearchTagData = {
            tag: tagRecord,
            parent: parent,
          };

          results.push(searchData);
        }

        // 递归处理子节点
        if (node.children.length > 0) {
          const currentParent: SearchTagData = {
            tag: {
              id: node.id || 0,
              name: node.name,
              description: "",
              materialCount: 0,
              parentId: parent?.tag.id || 0,
            },
            parent: parent,
          };
          collectSearchResults(node.children, currentParent);
        }
      }
    };

    collectSearchResults(getSearchResults());
    return results;
  };

  // 处理搜索输入
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setIsSearching(value.trim().length > 0);

      // 如果开始搜索，清除当前选择
      if (value.trim().length > 0) {
        setSelectedLevel1Id(null);
        setSelectedLevel2Id(null);
        setSelectedLevel3Id(null);
      } else {
        // 搜索清空时，恢复默认选择
        if (tagsTree.length > 0) {
          const firstLevel1 = tagsTree[0];
          setSelectedLevel1Id(getNodeId(firstLevel1));

          if (firstLevel1.children.length > 0) {
            const firstLevel2 = firstLevel1.children[0];
            setSelectedLevel2Id(getNodeId(firstLevel2));

            if (firstLevel2.children.length > 0) {
              const firstLevel3 = firstLevel2.children[0];
              setSelectedLevel3Id(getNodeId(firstLevel3));
            }
          }
        }
      }
    },
    [tagsTree, getNodeId],
  );

  // 处理搜索结果点击
  const handleSearchResultClick = useCallback(
    (data: TagRecord) => {
      // 清空搜索
      setSearchQuery("");
      setIsSearching(false);

      // 根据搜索结果找到对应的标签节点并选中
      const findAndSelectTag = (nodes: TagNode[], targetId: number): boolean => {
        for (const node of nodes) {
          if (node.id === targetId) {
            // 找到目标节点，设置选中状态
            setSelectedLevel1Id(getNodeId(node));
            setSelectedLevel2Id(null);
            setSelectedLevel3Id(null);
            return true;
          }

          // 递归查找子节点
          if (node.children.length > 0) {
            for (const child of node.children) {
              if (child.id === targetId) {
                // 找到二级标签
                setSelectedLevel1Id(getNodeId(node));
                setSelectedLevel2Id(getNodeId(child));
                setSelectedLevel3Id(null);
                return true;
              }

              // 查找三级标签
              if (child.children.length > 0) {
                for (const grandChild of child.children) {
                  if (grandChild.id === targetId) {
                    // 找到三级标签
                    setSelectedLevel1Id(getNodeId(node));
                    setSelectedLevel2Id(getNodeId(child));
                    setSelectedLevel3Id(getNodeId(grandChild));
                    return true;
                  }
                }
              }
            }
          }
        }
        return false;
      };

      // 在标签树中查找并选中对应的标签
      findAndSelectTag(tagsTree, data.id);
    },
    [tagsTree, getNodeId],
  );

  // 将 Prisma 数据转换为 TagNode 格式并按sort排序（数字越大越靠前）
  const convertToTagNodes = useCallback(
    (tags: (AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] })[]): TagNode[] => {
      return tags
        .sort((a, b) => b.sort - a.sort) // 按sort降序排序，数字越大越靠前
        .map((tag) => ({
          id: tag.id,
          slug: tag.slug,
          name: tag.name,
          originalName: tag.name,
          sort: tag.sort,
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

    // 按sort降序排序，新建的标签（tempId）排在最后
    return result.sort((a, b) => {
      if (a.id && b.id) return (b.sort || 0) - (a.sort || 0); // 数字越大越靠前
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

  // 获取不同层级的标签（支持搜索）
  const currentTagsTree = isSearching ? getSearchResults() : tagsTree;
  const level1Tags = getVisibleTags(currentTagsTree);
  const level2Tags = selectedLevel1 ? getVisibleTags(selectedLevel1.children) : [];
  const level3Tags = selectedLevel2 ? getVisibleTags(selectedLevel2.children) : [];

  // 计算节点的层级
  const getNodeLevel = (nodeId: string): number => {
    // 检查是否在第一级
    const level1Node = tagsTree.find((tag) => getNodeId(tag) === nodeId);
    if (level1Node) return 1;

    // 检查是否在第二级
    for (const level1 of tagsTree) {
      const level2Node = level1.children.find((tag) => getNodeId(tag) === nodeId);
      if (level2Node) return 2;

      // 检查是否在第三级
      for (const level2 of level1.children) {
        const level3Node = level2.children.find((tag) => getNodeId(tag) === nodeId);
        if (level3Node) return 3;
      }
    }

    return 1; // 默认返回1
  };

  // 获取节点的父节点ID
  const getParentNodeId = (nodeId: string): number | null => {
    const level = getNodeLevel(nodeId);

    if (level === 1) return null;

    // 查找父节点
    for (const level1 of tagsTree) {
      if (level === 2) {
        const level2Node = level1.children.find((tag) => getNodeId(tag) === nodeId);
        if (level2Node) return level1.id || null;
      } else if (level === 3) {
        for (const level2 of level1.children) {
          const level3Node = level2.children.find((tag) => getNodeId(tag) === nodeId);
          if (level3Node) return level2.id || null;
        }
      }
    }

    return null;
  };

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
  const addTag = async (level: 1 | 2 | 3) => {
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

    // 先更新本地状态
    setTagsTree((tree) => {
      const sortTags = (tags: TagNode[]) => {
        return [...tags].sort((a, b) => {
          // 新创建的标签（没有id）排在最后
          if (a.id && b.id) return (b.sort || 0) - (a.sort || 0); // 数字越大越靠前
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

    // 当用户完成编辑时，会通过 updateTagName 调用 saveSingleTagChange
    // 这里不需要立即调用，因为新标签还没有名称
  };
  // 更新标签名
  const updateTagName = async (nodeId: string, newName: string): Promise<boolean> => {
    const context = findNodeContext(tagsTree, nodeId);
    if (!context || isSaving) return false;

    if (checkNameDuplicate(newName, context.siblings, nodeId)) {
      toast.error(t("tagNameExists"));
      return false;
    }

    const node = context.node;

    // 更新本地状态
    setTagsTree((tree) =>
      updateNodeInTree(tree, nodeId, (node) => ({
        ...node,
        name: newName,
        verb: node.id ? (node.originalName !== newName ? "update" : undefined) : "create",
        isEditing: false,
      })),
    );

    // 直接调用 saveSingleTagChange
    try {
      setIsSaving(true);

      // 找到父节点ID和层级
      const parentId = getParentNodeId(nodeId);
      const level = getNodeLevel(nodeId);

      // 构建要保存的节点
      const nodeToSave: TagNode = {
        ...node,
        name: newName,
        verb: node.id ? (node.originalName !== newName ? "update" : undefined) : "create",
        isEditing: false,
      };

      const result = await saveSingleTagChange(nodeToSave, parentId, level);

      if (result.success) {
        toast.success(t("saveSuccess"));

        // 刷新数据
        const refreshResult = await fetchTeamTags();
        if (refreshResult.success) {
          const newTree = convertToTagNodes(refreshResult.data.tags);
          setTagsTree(newTree);
          setOriginalTags(refreshResult.data.tags);
        }

        return true;
      } else {
        toast.error(result.message || t("saveFailed"));
        // 恢复原值
        setTagsTree((tree) =>
          updateNodeInTree(tree, nodeId, (node) => ({
            ...node,
            name: node.originalName || node.name,
            verb: undefined,
            isEditing: false,
          })),
        );
        return false;
      }
    } catch (error) {
      console.error("Save tag name error:", error);
      toast.error(t("saveFailed"));
      // 恢复原值
      setTagsTree((tree) =>
        updateNodeInTree(tree, nodeId, (node) => ({
          ...node,
          name: node.originalName || node.name,
          verb: undefined,
          isEditing: false,
        })),
      );
      return false;
    } finally {
      setIsSaving(false);
    }
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

  // 删除标签
  const deleteTag = async (nodeId: string) => {
    const context = findNodeContext(tagsTree, nodeId);
    if (!context || isSaving) return;

    const node = context.node;

    // 更新本地状态
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

    // 直接调用 saveSingleTagChange
    try {
      setIsSaving(true);

      // 找到父节点ID和层级
      const parentId = getParentNodeId(nodeId);
      const level = getNodeLevel(nodeId);

      // 构建要保存的节点
      const nodeToSave: TagNode = {
        ...node,
        isDeleted: true,
        verb: "delete",
      };
      const result = await saveSingleTagChange(nodeToSave, parentId, level);

      if (result.success) {
        toast.success(t("saveSuccess"));

        // 刷新数据
        const refreshResult = await fetchTeamTags();
        if (refreshResult.success) {
          const newTree = convertToTagNodes(refreshResult.data.tags);
          setTagsTree(newTree);
          setOriginalTags(refreshResult.data.tags);
        }
      } else {
        toast.error(result.message || t("saveFailed"));
        // 恢复原值
        setTagsTree((tree) =>
          updateNodeInTree(tree, nodeId, (node) => ({
            ...node,
            isDeleted: false,
            verb: undefined,
          })),
        );
      }
    } catch (error) {
      console.error("Delete tag error:", error);
      toast.error(t("saveFailed"));
      // 恢复原值
      setTagsTree((tree) =>
        updateNodeInTree(tree, nodeId, (node) => ({
          ...node,
          isDeleted: false,
          verb: undefined,
        })),
      );
    } finally {
      setIsSaving(false);
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
  // const saveChanges = async () => {
  //   setIsSaving(true);
  //   try {
  //     // 1. 先保存标签详情变更
  //     if (editedTags.size > 0) {
  //       for (const [tagId, editData] of editedTags) {
  //         const result = await updateTagExtra(tagId, editData);
  //         if (!result.success) {
  //           toast.error(`${t("saveDetailsFailed")}: ${result.message}`);
  //           return;
  //         }
  //       }
  //     }

  //     // 2. 再保存标签树结构变更
  //     // 保存当前选中状态
  //     const currentLevel1 = selectedLevel1;
  //     const currentLevel2 = selectedLevel2;
  //     const currentLevel3 = selectedLevel3;
  //     const result = await saveTagsTree(tagsTree);
  //     if (result.success) {
  //       toast.success(t("saveSuccess"));

  //       // 3. 清空所有编辑状态
  //       clearAllEdits();

  //       // 4. 刷新数据
  //       const refreshResult = await fetchTeamTags();
  //       if (refreshResult.success) {
  //         const newTree = convertToTagNodes(refreshResult.data.tags);
  //         setTagsTree(newTree);
  //         setOriginalTags(refreshResult.data.tags);

  //         // 尝试恢复选中状态
  //         if (currentLevel1) {
  //           const newLevel1 = newTree.find((tag) => tag.name === currentLevel1.name);
  //           if (newLevel1) {
  //             setSelectedLevel1Id(getNodeId(newLevel1));

  //             if (currentLevel2) {
  //               const newLevel2 = newLevel1.children.find((tag) => tag.name === currentLevel2.name);
  //               if (newLevel2) {
  //                 setSelectedLevel2Id(getNodeId(newLevel2));

  //                 if (currentLevel3) {
  //                   const newLevel3 = newLevel2.children.find(
  //                     (tag) => tag.name === currentLevel3.name,
  //                   );
  //                   if (newLevel3) {
  //                     setSelectedLevel3Id(getNodeId(newLevel3));
  //                   } else {
  //                     setSelectedLevel3Id(null);
  //                   }
  //                 }
  //               } else {
  //                 setSelectedLevel2Id(null);
  //                 setSelectedLevel3Id(null);
  //               }
  //             }
  //           } else {
  //             setSelectedLevel1Id(null);
  //             setSelectedLevel2Id(null);
  //             setSelectedLevel3Id(null);
  //           }
  //         }
  //       }
  //     } else {
  //       toast.error(result.message || t("saveFailed"));
  //     }
  //   } catch (error) {
  //     console.error("Save error:", error);
  //     toast.error(t("saveFailed"));
  //   } finally {
  //     setIsSaving(false);
  //   }
  // };
  // 处理同步完成
  const handleSyncComplete = useCallback(async () => {
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
  }, [convertToTagNodes, setDefaultSelection]);

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
  const checkTagDetailChanges = useCallback(
    (tagId: number): boolean => {
      return editedTags.has(tagId);
    },
    [editedTags],
  );

  // 处理标签排序
  const handleSortTags = useCallback(
    async (level: 1 | 2 | 3, sortedTags: TagNode[]) => {
      try {
        setIsSaving(true);
        // 同步更新排序值(sort)并生成最新树
        const applySortValue = (list: TagNode[]): TagNode[] =>
          list.map((item, index) => ({
            ...item,
            // 数字越大越靠前，因此首位应为最大值
            sort: list.length - index,
          }));

        const buildUpdatedTree = (nodes: TagNode[]): TagNode[] => {
          if (level === 1) {
            return applySortValue(sortedTags).map((node) => ({
              ...node,
              // 不改变各自的子节点顺序
              children: node.children,
            }));
          }

          return nodes.map((node) => {
            if (level === 2 && getNodeId(node) === selectedLevel1Id) {
              return {
                ...node,
                children: applySortValue(sortedTags).map((child) => ({
                  ...child,
                  children: child.children,
                })),
              };
            }
            if (level === 3 && getNodeId(node) === selectedLevel2Id) {
              // 这里不会命中，因为第3级排序的匹配在二级节点上
              // 保持不变
              return node;
            }
            return {
              ...node,
              children:
                level === 3 && getNodeId(node) === selectedLevel1Id
                  ? node.children.map((child) =>
                      getNodeId(child) === selectedLevel2Id
                        ? {
                            ...child,
                            children: applySortValue(sortedTags),
                          }
                        : child,
                    )
                  : buildUpdatedTree(node.children),
            };
          });
        };

        const newTree = buildUpdatedTree(tagsTree);
        setTagsTree(newTree);
        await saveTagsTree(newTree);
        toast.success(t("sortSuccess"));
      } catch (error) {
        console.error("Sort tags error:", error);
        toast.error(t("sortFailed"));
      } finally {
        setIsSaving(false);
      }
    },
    [tagsTree, selectedLevel1Id, selectedLevel2Id, getNodeId, t],
  );

  const TagsHeaderMenu = useMemo(
    () => (
      <div className="bg-background border rounded-md p-2 flex justify-between items-center gap-3">
        <div className="flex items-center gap-4 flex-1 relative">
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            className="w-full pl-10 pr-10"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
            <svg
              className="w-4 h-4 text-basic-5"
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
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-basic-5 hover:text-foreground"
              onClick={() => handleSearchChange("")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* AI自动打标签开关 */}
          {/* <div className="flex items-center gap-2">
          <Switch />
          <span className="text-sm text-basic-5">{t("aiAutoTagging")}</span>
        </div> */}
          <div className="flex items-center gap-2">
            <SyncConfirmDialog onSyncComplete={handleSyncComplete} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreateModalVisible(true);
            }}
          >
            {t("batchCreate")}
          </Button>
        </div>
      </div>
    ),
    [t, searchQuery, handleSearchChange, handleSyncComplete],
  );

  const TagMainColumns = useMemo(
    () => (
      <ThreeTagList
        title={t("tagManagement")}
        list1={level1Tags}
        list2={level2Tags}
        list3={level3Tags}
        total1={level1Tags.length}
        total2={level2Tags.length}
        total3={level3Tags.length}
        selectedLevel1Id={selectedLevel1Id}
        selectedLevel2Id={selectedLevel2Id}
        selectedLevel3Id={selectedLevel3Id}
        onSelectLevel1={(nodeId) => {
          setSelectedLevel1Id(nodeId);
          setSelectedLevel2Id(null);
          setSelectedLevel3Id(null);
        }}
        onSelectLevel2={(nodeId) => {
          setSelectedLevel2Id(nodeId);
          setSelectedLevel3Id(null);
        }}
        onSelectLevel3={(nodeId) => setSelectedLevel3Id(nodeId)}
        onEdit={updateTagName}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onDelete={deleteTag}
        onRestore={restoreTag}
        onAddTag={addTag}
        getNodeId={getNodeId}
        hasDetailChanges={checkTagDetailChanges}
        showAdd={!isSearching}
        showAiTags={true}
        canEdit={!isSearching}
        onSortTags={handleSortTags}
      />
    ),
    [
      t,
      level1Tags,
      level2Tags,
      level3Tags,
      selectedLevel1Id,
      selectedLevel2Id,
      selectedLevel3Id,
      updateTagName,
      startEdit,
      cancelEdit,
      deleteTag,
      restoreTag,
      addTag,
      getNodeId,
      checkTagDetailChanges,
      isSearching,
    ],
  );

  return (
    <div className="h-dvh min-w-[60rem] overflow-x-scroll scrollbar-thin flex flex-col items-stretch gap-4 p-4 bg-basic-1">
      {TagsHeaderMenu}
      <div className="flex-1 overflow-hidden flex flex-row items-stretch gap-4">
        {isSearching ? (
          <SearchResult
            searchData={getSearchResultsAsData()}
            handleClick={handleSearchResultClick}
          />
        ) : (
          TagMainColumns
        )}
        <TagDetails
          selectedTag={getSelectedTag()}
          refreshTags={async () => {
            // 刷新数据
            const refreshResult = await fetchTeamTags();
            if (refreshResult.success) {
              const newTree = convertToTagNodes(refreshResult.data.tags);
              setTagsTree(newTree);
              setOriginalTags(refreshResult.data.tags);
            }
          }}
        />
      </div>
      <CreateModal
        visible={createModalVisible}
        setVisible={setCreateModalVisible}
        refresh={handleSyncComplete}
      />
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
