"use client";
import "@/embed/message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssetTag } from "@/prisma/client";
import { AssetTagTreeNode, MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { fetchTeamTags, saveTagsTree, saveTagsTreeToMuseDAM } from "./actions";
import { deleteTagAndDescendants } from "./delete-tag";
import { localizeTagActionMessage } from "./tagActionMessage";
import { AiCreateModal } from "./components/AiCreateModal";
import { BatchCreateModal } from "./components/BatchCreateModal";
import { CreateModal } from "./components/CreateModal";
import { SearchResult } from "./components/SearchResult";
import { SyncConfirmDialog } from "./components/SyncConfirmDialog";
import { UpdateToMuseDialog } from "./components/UpdateToMuseDialog";
import { TagDetails } from "./components/TagDetails";
import { TagLevelColumns } from "./components/TagLevelColumns";
import { TagSettingDialog } from "./components/TagSettingDialog";
import { useEnterpriseTagSetting } from "./hooks/useEnterpriseTagSetting";
import { TagEditProvider, useTagEdit } from "./contexts/TagEditContext";
import { SearchTagData, TagNode, TagRecord } from "./types";
import { PlusIcon, SearchIcon, X } from "lucide-react";
import { useTagManagementPermission } from "./hooks/useTagManagementPermission";
import { useSession } from "@/components/AuthProvider";

interface TagsClientProps {
  initialTags: AssetTagTreeNode[];
}

const SMART_TAGS_ID = "-1";

/** 各层级（1 ~ MAX_TAG_LEVEL）选中的节点 ID，selection[i] 对应第 i + 1 级 */
type Selection = (string | null)[];

const TAG_LEVELS = Array.from({ length: MAX_TAG_LEVEL }, (_, i) => i + 1);
const selectionUrlKey = (level: number) => `l${level}`;

/** 补齐到 MAX_TAG_LEVEL 长度，且某级为空时其后各级也置空 */
function normalizeSelection(selection: Selection): Selection {
  let broken = false;
  return TAG_LEVELS.map((level) => {
    const value = broken ? null : (selection[level - 1] ?? null);
    if (!value || value === SMART_TAGS_ID) broken = true;
    return value;
  });
}

function persistableTagId(id: string | null): string | null {
  if (!id || id.startsWith("temp_")) return null;
  return id;
}

function writeSelectionToUrl(selection: Selection) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  // 逐级写入：上级无效（临时节点 / 智能标签）时，下级都不写
  let parentPersisted = true;
  TAG_LEVELS.forEach((level) => {
    const value = parentPersisted ? persistableTagId(selection[level - 1] ?? null) : null;
    if (value) params.set(selectionUrlKey(level), value);
    else params.delete(selectionUrlKey(level));
    parentPersisted = !!value && value !== SMART_TAGS_ID;
  });

  const search = params.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  window.history.replaceState(window.history.state, "", nextUrl);
}

function resolveSelection(
  tree: TagNode[],
  getNodeId: (node: TagNode) => string,
  requested: Selection,
  fallbackToFirst: boolean,
): Selection {
  if (requested[0] === SMART_TAGS_ID) {
    return normalizeSelection([SMART_TAGS_ID]);
  }

  const level1 = requested[0] ? tree.find((node) => getNodeId(node) === requested[0]) : undefined;
  if (!level1) {
    if (!fallbackToFirst || tree.length === 0) {
      return normalizeSelection([]);
    }
    // 默认沿每级第一个节点向下选中
    const path: Selection = [];
    let nodes: TagNode[] = tree;
    while (path.length < MAX_TAG_LEVEL && nodes.length > 0) {
      path.push(getNodeId(nodes[0]));
      nodes = nodes[0].children;
    }
    return normalizeSelection(path);
  }

  // 逐级在上一级的子节点中查找请求的 ID，找不到即停止
  const path: Selection = [getNodeId(level1)];
  let current = level1;
  for (let level = 2; level <= MAX_TAG_LEVEL; level++) {
    const requestedId = requested[level - 1];
    const next = requestedId
      ? current.children.find((node) => getNodeId(node) === requestedId)
      : undefined;
    if (!next) break;
    path.push(getNodeId(next));
    current = next;
  }
  return normalizeSelection(path);
}

function TagsClientInner({ initialTags }: TagsClientProps) {
  const t = useTranslations("TagsPage");
  // const { editedTags, clearAllEdits, hasAnyEdits } = useTagEdit();
  const { editedTags } = useTagEdit();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [tagsTree, setTagsTree] = useState<TagNode[]>([]);
  const [originalTags, setOriginalTags] = useState<AssetTagTreeNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<Selection>(() =>
    TAG_LEVELS.map((level) => searchParams.get(selectionUrlKey(level))),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [nextTempId, setNextTempId] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [batchCreateModalVisible, setBatchCreateModalVisible] = useState(false);
  const [aiCreateModalVisible, setAiCreateModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // 判断当前登录用户是否是 admin
  const isAdmin = session?.user?.isAdmin ?? false;
  const canManageTags = useTagManagementPermission();
  const { setting } = useEnterpriseTagSetting();
  const tagLevel = setting.tagLevel;

  // 移除了 tagExtraChanges 状态，现在使用 Context

  // 获取节点的唯一标识符
  const getNodeId = useCallback((node: TagNode): string => {
    return node.id ? node.id.toString() : node.tempId!;
  }, []);

  const applySelection = useCallback((selection: Selection, persist = true) => {
    const normalized = normalizeSelection(selection);
    setSelectedIds(normalized);
    if (persist) {
      writeSelectionToUrl(normalized);
    }
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
    },
    [],
  );

  // 处理搜索结果点击
  const handleSearchResultClick = useCallback(
    (data: TagRecord) => {
      // 清空搜索
      setSearchQuery("");
      setIsSearching(false);

      // 根据搜索结果找到对应的标签节点，返回从根到该节点的 ID 路径
      const findTagPath = (nodes: TagNode[], targetId: number, prefix: string[] = []): string[] | null => {
        for (const node of nodes) {
          const path = [...prefix, getNodeId(node)];
          if (node.id === targetId) return path;
          const found = findTagPath(node.children, targetId, path);
          if (found) return found;
        }
        return null;
      };

      // 在标签树中查找并选中对应的标签
      const path = findTagPath(tagsTree, data.id);
      if (path) applySelection(path);
    },
    [tagsTree, getNodeId, applySelection],
  );

  // 将 Prisma 数据转换为 TagNode 格式并按sort排序（数字越大越靠前），sort相同时按id升序排序
  const convertToTagNodes = useCallback(
    (tags: AssetTagTreeNode[]): TagNode[] => {
      return tags
        .sort((a, b) => {
          // 先按sort降序排序，数字越大越靠前
          if (a.sort !== b.sort) {
            return b.sort - a.sort;
          }
          // sort相同时，按id升序排序，id小的在前
          return a.id - b.id;
        })
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

  const restoreSelection = useCallback(
    (tree: TagNode[], requested: Selection) => {
      applySelection(resolveSelection(tree, getNodeId, requested, true));
    },
    [getNodeId, applySelection],
  );

  // 只随 initialTags 变化同步本地树；不能依赖选中状态，否则切换选中会用首屏的旧 initialTags
  // 覆盖掉保存后 refetch 得到的新树（表现为修改后自动跳回修改前）
  useEffect(() => {
    const newTree = convertToTagNodes(initialTags);
    setTagsTree(newTree);
    setOriginalTags(initialTags);
    setIsLoading(false);
  }, [initialTags, convertToTagNodes]);

  // 设置默认选中状态（优先恢复 URL 中的选中），仅在首次拿到非空树时执行一次
  useEffect(() => {
    if (initialized || tagsTree.length === 0) return;
    restoreSelection(tagsTree, selectedIds);
    setInitialized(true);
  }, [initialized, tagsTree, restoreSelection, selectedIds]);

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

  // 获取各级选中的节点（selectedNodes[i] 为第 i + 1 级）
  const selectedNodes = selectedIds.map((id) => (id ? findNodeById(tagsTree, id) : null));

  // 获取不同层级的标签（支持搜索）：一级来自（搜索后的）整棵树，其余为上一级选中节点的子节点
  const currentTagsTree = isSearching ? getSearchResults() : tagsTree;
  const levelTags: TagNode[][] = TAG_LEVELS.map((level) => {
    if (level === 1) {
      return getVisibleTags(currentTagsTree).map(
        (tag) => findNodeById(tagsTree, getNodeId(tag)) || tag,
      );
    }
    const parent = selectedNodes[level - 2];
    return parent ? getVisibleTags(parent.children) : [];
  });

  // 检查同级标签名是否重复
  const checkNameDuplicate = (name: string, siblings: TagNode[], excludeId?: string) => {
    return siblings.some(
      (tag) =>
        getNodeId(tag) !== excludeId &&
        !tag.isDeleted &&
        tag.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
  };

  // 刷新数据
  const refetchTagsTree = async () => {
    setIsLoading(true);
    const refreshResult = await fetchTeamTags();
    if (refreshResult.success) {
      const newTree = convertToTagNodes(refreshResult.data.tags);
      setTagsTree(newTree);
      setOriginalTags(refreshResult.data.tags);
    }
    setIsLoading(false);
  };

  // 添加标签
  const addTag = async (level: number) => {
    if (!canManageTags) return;
    if (level < 1 || level > tagLevel) return;
    const parentId = level === 1 ? null : selectedIds[level - 2];
    if (level > 1 && (!parentId || parentId === SMART_TAGS_ID)) return;

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

      if (!parentId) {
        return sortTags([...tree, newTag]);
      }
      return updateNodeInTree(tree, parentId, (node) => ({
        ...node,
        children: sortTags([...node.children, newTag]),
      }));
    });

    // 当用户完成编辑时，会通过 updateTagName 调用 saveSingleTagChange
    // 这里不需要立即调用，因为新标签还没有名称
  };

  // 更新标签名
  const updateTagName = async (nodeId: string, newName: string): Promise<boolean> => {
    if (!canManageTags) return false;
    const context = findNodeContext(tagsTree, nodeId);
    if (!context || isSaving) return false;

    if (checkNameDuplicate(newName, context.siblings, nodeId)) {
      toast.error(t("tagNameExists"));
      return false;
    }

    const node = context.node;

    // 简化：基于更新后的整棵树保存
    try {
      setIsSaving(true);

      const updatedTree = updateNodeInTree(tagsTree, nodeId, (node) => ({
        ...node,
        name: newName,
        verb: node.id ? (node.originalName !== newName ? "update" : undefined) : "create",
        isEditing: false,
      }));

      setTagsTree(updatedTree);

      const result = await saveTagsTree(updatedTree);

      if (result.success) {
        toast.success(t("saveSuccess"));
        await refetchTagsTree();
        return true;
      } else {
        toast.error(localizeTagActionMessage(result.message, t) || t("saveFailed"));
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
    if (!canManageTags) return;
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

  // 删除使用服务端完整标签树，避免搜索过滤或过期数据漏掉子标签。
  const deleteTag = async (nodeId: string): Promise<boolean> => {
    if (!canManageTags) return false;
    const context = findNodeContext(tagsTree, nodeId);
    if (!context || isSaving) return false;
    try {
      setIsSaving(true);
      if (context.node.id) {
        const result = await deleteTagAndDescendants(context.node.id);
        if (!result.success) {
          toast.error(localizeTagActionMessage(result.message, t) || t("saveFailed"));
          return false;
        }
        await refetchTagsTree();
      } else {
        setTagsTree((tree) => updateNodeInTree(tree, nodeId, () => null));
      }
      // 被删节点在选中路径上时，清空它及其下级的选中
      const selectedIndex = selectedIds.indexOf(nodeId);
      if (selectedIndex >= 0) {
        applySelection(selectedIds.slice(0, selectedIndex));
      }
      toast.success(t("saveSuccess"));
      return true;
    } catch (error) {
      console.error("Delete tag error:", error);
      toast.error(t("saveFailed"));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // 恢复删除
  const restoreTag = (nodeId: string) => {
    if (!canManageTags) return;
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
  //     toast.error(t("saveFailed"));
  //   } finally {
  //     setIsSaving(false);
  //   }
  // };
  // 处理同步完成
  const handleSyncComplete = useCallback(async () => {
    setIsLoading(true);
    const refreshResult = await fetchTeamTags();
    if (refreshResult.success) {
      const newTree = convertToTagNodes(refreshResult.data.tags);
      setTagsTree(newTree);
      toast.success(t("TagsClient.tagCreatedSuccessfully"));
      setOriginalTags(refreshResult.data.tags);

      restoreSelection(newTree, selectedIds);

      // 认为已完成初始化
      setInitialized(true);
    }
    setIsLoading(false);
  }, [convertToTagNodes, restoreSelection, selectedIds, t]);

  // 从原始标签中查找AssetTag
  const findOriginalTag = (
    tags: AssetTagTreeNode[],
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
    // 取选中路径上最深的一级
    let selectedNode: TagNode | null = null;
    let level = 0;
    for (let i = selectedNodes.length - 1; i >= 0; i--) {
      if (selectedNodes[i]) {
        selectedNode = selectedNodes[i];
        level = i + 1;
        break;
      }
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
    async (level: number, sortedTags: TagNode[]) => {
      if (!canManageTags) return;
      try {
        setIsSaving(true);
        // 同步更新排序值(sort)：数字越大越靠前，因此首位应为最大值；不改变各自子节点顺序
        const sortedWithValue = sortedTags.map((item, index) => ({
          ...item,
          sort: sortedTags.length - index,
        }));

        // 用排好序的列表替换指定父节点的 children（不重排其他层级）
        const replaceChildren = (nodes: TagNode[], parentId: string): TagNode[] =>
          nodes.map((node) =>
            getNodeId(node) === parentId
              ? { ...node, children: sortedWithValue }
              : { ...node, children: replaceChildren(node.children, parentId) },
          );

        let newTree: TagNode[];
        if (level === 1) {
          newTree = sortedWithValue;
        } else {
          const parentId = selectedIds[level - 2];
          if (!parentId) return;
          newTree = replaceChildren(tagsTree, parentId);
        }

        setTagsTree(newTree);
        const result = await saveTagsTreeToMuseDAM(newTree);
        if (!result.success) {
          toast.error(localizeTagActionMessage(result.message, t) || t("sortFailed"));
          refetchTagsTree();
          return;
        }
        refetchTagsTree();
        toast.success(t("sortSuccess"));
      } catch (error) {
        toast.error(
          localizeTagActionMessage(error instanceof Error ? error.message : null, t) ||
            t("sortFailed"),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [tagsTree, selectedIds, getNodeId, t, canManageTags],
  );

  const TagsHeaderMenu = useMemo(
    () => (
      <div className="bg-background border rounded-md p-2 flex justify-between items-center gap-3">
        <div className="flex items-center gap-4 flex-1 relative">
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            className="w-full pl-[30px] pr-10 border-none h-[32px] !hover:border-none !focus:border-none !focus:shadow-none !focus-visible:border-none !focus-visible:shadow-none"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-basic-5" size={14} />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 transform -translate-y-1/2 group"
              onClick={() => handleSearchChange("")}
            >
              <X className=" text-basic-5 group-hover:text-basic-8 ease-in-out transition-all duration-300" size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* AI自动打标签-手动同步 */}
          {isAdmin && canManageTags && <>
            <div className="flex items-center gap-2">
              <UpdateToMuseDialog onSyncComplete={handleSyncComplete} />
              <SyncConfirmDialog onSyncComplete={handleSyncComplete} />
            </div>
          </>}
          {canManageTags && <Button
            variant="default"
            size="sm"
            onClick={() => {
              setBatchCreateModalVisible(true);
            }}
          >
            <PlusIcon className="size-[14px]" />
            {t("batchCreate")}
          </Button>}
        </div>
      </div>
    ),
    [t, searchQuery, handleSearchChange, handleSyncComplete, isAdmin, canManageTags],
  );

  const TagMainColumns = useMemo(
    () => (
      <TagLevelColumns
        title={t("tagManagement")}
        headerExtra={
          canManageTags ? (
            <TagSettingDialog onLevelChanged={refetchTagsTree} />
          ) : undefined
        }
        lists={levelTags}
        selectedIds={selectedIds}
        onSelect={(level, nodeId) => applySelection([...selectedIds.slice(0, level - 1), nodeId])}
        onEdit={updateTagName}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onDelete={deleteTag}
        onRestore={restoreTag}
        onAddTag={addTag}
        getNodeId={getNodeId}
        hasDetailChanges={checkTagDetailChanges}
        showAdd={canManageTags && !isSearching}
        levelCount={tagLevel}
        showAiTags={true}
        canEdit={canManageTags && !isSearching}
        onSortTags={canManageTags ? handleSortTags : undefined}
        loading={isLoading}
      />
    ),
    [
      t,
      canManageTags,
      tagsTree,
      tagLevel,
      refetchTagsTree,
      levelTags,
      selectedIds,
      applySelection,
      updateTagName,
      startEdit,
      cancelEdit,
      deleteTag,
      restoreTag,
      addTag,
      getNodeId,
      checkTagDetailChanges,
      isSearching,
      isLoading,
      handleSortTags,
    ],
  );

  return (
    // 横向滚动收敛在标签列区域内部；页面只保留一个兜底最小宽度
    <div className="h-dvh min-w-[48rem] overflow-x-auto scrollbar-thin flex flex-col items-stretch gap-4 p-4 bg-basic-1">
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
        <TagDetails canEdit={canManageTags} selectedTag={getSelectedTag()} refreshTags={refetchTagsTree} />
      </div>
      {canManageTags && <>
      <BatchCreateModal
        visible={batchCreateModalVisible}
        setVisible={setBatchCreateModalVisible}
        onSelectAiCreate={() => setAiCreateModalVisible(true)}
        onSelectManualCreate={() => setCreateModalVisible(true)}
      />
      <AiCreateModal
        visible={aiCreateModalVisible}
        setVisible={setAiCreateModalVisible}
        onSuccess={handleSyncComplete}
      />
      <CreateModal
        visible={createModalVisible}
        setVisible={setCreateModalVisible}
        refresh={handleSyncComplete}
      />
      </>}
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
