import { dispatchMuseDAMClientAction } from "@/embed/message";
import { slugToId } from "@/lib/slug";
import { AssetTag } from "@/prisma/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const DEFAULT_UNCATEGORIZED_NAME = "未分类";

type PendingInboundConfig = {
  enabled: boolean;
  uncategorizedName: string;
};

type PendingInboundRequiredItem = {
  id: number;
  tagId: number;
};

function normalizeTagId(id: unknown): number | null {
  const value = Number(id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getMuseDamTagId(tag: AssetTag): number | null {
  if (!tag.slug) return null;
  try {
    return Number(slugToId("assetTag", tag.slug));
  } catch {
    return null;
  }
}

export function usePendingInboundTagRequired(
  selectedTag: { tag: AssetTag; level: number } | null,
) {
  const [config, setConfig] = useState<PendingInboundConfig>({
    enabled: false,
    uncategorizedName: DEFAULT_UNCATEGORIZED_NAME,
  });
  const [required, setRequired] = useState(false);
  const [configId, setConfigId] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleConfigChange = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PendingInboundConfig>>).detail;
      setConfig({
        enabled: !!detail?.enabled,
        uncategorizedName: detail?.uncategorizedName ?? DEFAULT_UNCATEGORIZED_NAME,
      });
    };

    window.addEventListener("pending-inbound-config-change", handleConfigChange);
    return () => window.removeEventListener("pending-inbound-config-change", handleConfigChange);
  }, []);

  const museDamTagId = useMemo(() => {
    if (!selectedTag?.tag) return null;
    return getMuseDamTagId(selectedTag.tag);
  }, [selectedTag?.tag]);

  const isFirstUncategorized = useMemo(() => {
    if (!selectedTag) return false;
    return selectedTag.level === 1 && selectedTag.tag.name === config.uncategorizedName;
  }, [selectedTag, config.uncategorizedName]);

  const showSwitch = config.enabled && museDamTagId !== null && !isFirstUncategorized;

  const fetchRequiredState = useCallback(async () => {
    if (!museDamTagId || !config.enabled) {
      setRequired(false);
      setConfigId(undefined);
      return;
    }

    try {
      const { list } = await dispatchMuseDAMClientAction("list-tag-pending-inbound-required", {});
      const current = list.find((item) => normalizeTagId(item.tagId) === museDamTagId);
      setRequired(!!current);
      setConfigId(current?.id);
    } catch {
      setRequired(false);
      setConfigId(undefined);
    }
  }, [museDamTagId, config.enabled]);

  useEffect(() => {
    fetchRequiredState();
  }, [fetchRequiredState]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!museDamTagId || loading) return;

      setLoading(true);
      const previousRequired = required;
      const previousConfigId = configId;
      setRequired(checked);

      try {
        await dispatchMuseDAMClientAction("set-tag-pending-inbound-required", {
          tagId: museDamTagId,
          required: checked,
          configId: previousConfigId,
        });
        await fetchRequiredState();
      } catch (error: unknown) {
        setRequired(previousRequired);
        setConfigId(previousConfigId);
        const message = error instanceof Error ? error.message : undefined;
        toast.error(message || "Update failed");
      } finally {
        setLoading(false);
      }
    },
    [museDamTagId, loading, required, configId, fetchRequiredState],
  );

  return {
    showSwitch,
    required,
    loading,
    handleToggle,
  };
}
