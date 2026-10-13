import { dispatchMuseDAMClientAction } from "@/embed/message";
import { slugToId } from "@/lib/slug";
import { AssetTag } from "@/prisma/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { VisibilitySelection } from "../components/TagVisibilityDisplay";

export const EMPTY_VISIBILITY_SELECTION: VisibilitySelection = {
  members: [],
  departments: [],
  groups: [],
};

function getMuseDamTagId(tag: AssetTag): number | null {
  if (!tag.slug) return null;
  try {
    return Number(slugToId("assetTag", tag.slug));
  } catch {
    return null;
  }
}

/**
 * 一级标签可见范围：通过宿主 MuseDAM 读写，只有一级标签且已同步到 MuseDAM（有 slug）时可配置。
 */
export function useTagVisibility(selectedTag: { tag: AssetTag; level: number } | null) {
  const museDamTagId = useMemo(() => {
    if (!selectedTag || selectedTag.level !== 1) return null;
    return getMuseDamTagId(selectedTag.tag);
  }, [selectedTag]);

  const [selection, setSelection] = useState<VisibilitySelection>(EMPTY_VISIBILITY_SELECTION);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelection(EMPTY_VISIBILITY_SELECTION);
    if (!museDamTagId) return;
    let cancelled = false;
    dispatchMuseDAMClientAction("get-tag-visibility", { tagId: museDamTagId })
      .then((result) => {
        if (!cancelled) setSelection(result);
      })
      .catch(() => {
        // 获取失败时按全员可见展示，不阻塞标签详情
      });
    return () => {
      cancelled = true;
    };
  }, [museDamTagId]);

  /** 打开宿主成员选择器，确认后保存；用户取消时返回 false */
  const selectAndSave = useCallback(
    async (title: string) => {
      if (!museDamTagId) return false;
      setLoading(true);
      try {
        const toItems = (list: Array<{ id: unknown; name: string }>) =>
          list.map((item) => ({ id: String(item.id), name: item.name }));
        let result: VisibilitySelection;
        try {
          result = await dispatchMuseDAMClientAction("member-selector-modal-open", {
            canSelectMe: true,
            title,
            selectedItems: {
              members: toItems(selection.members),
              departments: toItems(selection.departments),
              groups: toItems(selection.groups),
            },
          });
        } catch (error) {
          if (error instanceof Error && error.message === "用户取消操作") return false;
          throw error;
        }
        await dispatchMuseDAMClientAction("set-tag-visibility", {
          tagId: museDamTagId,
          userIds: result.members.map((item) => String(item.id)),
          departmentIds: result.departments.map((item) => String(item.id)),
          groupIds: result.groups.map((item) => String(item.id)),
        });
        setSelection(result);
        return true;
      } finally {
        setLoading(false);
      }
    },
    [museDamTagId, selection],
  );

  return { canConfigure: museDamTagId !== null, selection, loading, selectAndSave };
}
