import "server-only";
import { randomUUID } from "node:crypto";
import { slugToId } from "@/lib/slug";
import { flushMetadataSettingAudits } from "@/musedam/metadata-settings-audit";

import {
  DEFAULT_TAGGING_SETTINGS,
  TAGGING_CONFIG_KEYS,
  TaggingSettingsData,
} from "@/app/(tagging)/types";
import prisma from "@/prisma/prisma";

// 获取设置数据
export async function getTaggingSettings(teamId: number): Promise<TaggingSettingsData> {
  // 从数据库获取团队配置
  const configs = await prisma.teamConfig.findMany({
    where: {
      teamId,
      key: {
        in: Object.values(TAGGING_CONFIG_KEYS),
      },
    },
  });

  // 创建一个辅助函数来获取配置值
  const getConfigValue = <T>(key: string, defaultValue: T): T => {
    const config = configs.find((c) => c.key === key);
    return config ? (config.value as T) : defaultValue;
  };

  // 合并默认设置和数据库设置
  const settings: TaggingSettingsData = {
    isTaggingEnabled: getConfigValue(
      TAGGING_CONFIG_KEYS.IS_TAGGING_ENABLED,
      DEFAULT_TAGGING_SETTINGS.isTaggingEnabled,
    ),
    isMetadataEnabled: getConfigValue(TAGGING_CONFIG_KEYS.IS_METADATA_ENABLED, false),
    taggingMode: getConfigValue(
      TAGGING_CONFIG_KEYS.TAGGING_MODE,
      DEFAULT_TAGGING_SETTINGS.taggingMode,
    ),
    recognitionAccuracy: getConfigValue(
      TAGGING_CONFIG_KEYS.RECOGNITION_ACCURACY,
      DEFAULT_TAGGING_SETTINGS.recognitionAccuracy,
    ),
    matchingSources: getConfigValue(
      TAGGING_CONFIG_KEYS.MATCHING_SOURCES,
      DEFAULT_TAGGING_SETTINGS.matchingSources,
    ),
    sourceWeights: {
      // 逐项合并默认值，兼容旧数据或未来新增的来源
      ...DEFAULT_TAGGING_SETTINGS.sourceWeights,
      ...getConfigValue<Partial<TaggingSettingsData["sourceWeights"]>>(
        TAGGING_CONFIG_KEYS.SOURCE_WEIGHTS,
        {},
      ),
    },
    applicationScope: getConfigValue(
      TAGGING_CONFIG_KEYS.APPLICATION_SCOPE,
      DEFAULT_TAGGING_SETTINGS.applicationScope,
    ),
    triggerTiming: getConfigValue(
      TAGGING_CONFIG_KEYS.TRIGGER_TIMING,
      DEFAULT_TAGGING_SETTINGS.triggerTiming,
    ),
  };

  return settings;
}

// 保存设置数据
export async function saveTaggingSettings(
  teamId: number,
  data: TaggingSettingsData,
  actorSlug?: string,
): Promise<void> {
  // 使用事务保存各个配置项
  await prisma.$transaction(async (tx) => {
    if (actorSlug) {
      const before = await tx.teamConfig.findUnique({ where: { teamId_key: { teamId, key: TAGGING_CONFIG_KEYS.IS_METADATA_ENABLED } } });
      if ((before?.value === true) !== data.isMetadataEnabled) {
        const requestId = `metadataSettingAudit:${randomUUID()}`;
        await tx.teamConfig.create({ data: { teamId, key: requestId, value: { requestId, actorUserId: slugToId("user", actorSlug).toString(), before: before?.value === true, after: data.isMetadataEnabled } } });
      }
    }
    // 保存各个配置项到不同的 key
    const configUpdates = [
      { key: TAGGING_CONFIG_KEYS.IS_METADATA_ENABLED, value: data.isMetadataEnabled ?? false },
      {
        key: TAGGING_CONFIG_KEYS.IS_TAGGING_ENABLED,
        value: data.isTaggingEnabled,
      },
      {
        key: TAGGING_CONFIG_KEYS.TAGGING_MODE,
        value: data.taggingMode,
      },
      {
        key: TAGGING_CONFIG_KEYS.RECOGNITION_ACCURACY,
        value: data.recognitionAccuracy,
      },
      {
        key: TAGGING_CONFIG_KEYS.MATCHING_SOURCES,
        value: data.matchingSources,
      },
      {
        key: TAGGING_CONFIG_KEYS.SOURCE_WEIGHTS,
        value: data.sourceWeights,
      },
      {
        key: TAGGING_CONFIG_KEYS.APPLICATION_SCOPE,
        value: data.applicationScope,
      },
      {
        key: TAGGING_CONFIG_KEYS.TRIGGER_TIMING,
        value: data.triggerTiming,
      }
    ];

    // 批量更新配置
    for (const config of configUpdates) {
      await tx.teamConfig.upsert({
        where: {
          teamId_key: {
            teamId,
            key: config.key,
          },
        },
        update: {
          value: config.value,
        },
        create: {
          teamId,
          key: config.key,
          value: config.value,
        },
      });
    }
  });
  if (actorSlug) await flushMetadataSettingAudits(teamId).catch(() => console.warn("Metadata settings audit delivery pending", { teamId }));
}

// 重置设置为默认值
export async function resetTaggingSettings(teamId: number, actorSlug?: string): Promise<TaggingSettingsData> {
  await saveTaggingSettings(teamId, DEFAULT_TAGGING_SETTINGS, actorSlug);
  return DEFAULT_TAGGING_SETTINGS;
}
