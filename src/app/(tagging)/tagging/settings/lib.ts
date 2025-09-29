import "server-only";

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
    applicationScope: getConfigValue(
      TAGGING_CONFIG_KEYS.APPLICATION_SCOPE,
      DEFAULT_TAGGING_SETTINGS.applicationScope,
    ),
    // 触发时机
    triggerTiming: {
      autoRealtimeTagging: true,
      manualTriggerTagging: true,
      scheduledTagging: false,
    },
  };

  return settings;
}

// 保存设置数据
export async function saveTaggingSettings(
  teamId: number,
  data: TaggingSettingsData,
): Promise<void> {
  // 使用事务保存各个配置项
  await prisma.$transaction(async (tx) => {
    // 保存各个配置项到不同的 key
    const configUpdates = [
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
        key: TAGGING_CONFIG_KEYS.APPLICATION_SCOPE,
        value: data.applicationScope,
      },
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
}

// 重置设置为默认值
export async function resetTaggingSettings(teamId: number): Promise<TaggingSettingsData> {
  await saveTaggingSettings(teamId, DEFAULT_TAGGING_SETTINGS);
  return DEFAULT_TAGGING_SETTINGS;
}
