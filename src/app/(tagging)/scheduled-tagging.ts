import "server-only";

import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { rootLogger } from "@/lib/logging";
import { slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import prisma from "@/prisma/prisma";

const logger = rootLogger.child({ service: "process-scheduled-tagging" });

export async function runScheduledTagging() {
  logger.info("开始定时标签任务处理");

  // 查询所有启用了定时标签的团队
  // 先获取所有团队的配置，然后筛选启用定时标签的团队
  const teams = await prisma.team.findMany({
    include: {
      configs: true,
    },
  });

  const teamsWithScheduledTagging = [];

  for (const team of teams) {
    try {
      const settings = await getTaggingSettings(team.id);
      // 开启了打标，且开启了定时打标
      if (settings.isTaggingEnabled && settings.triggerTiming.scheduledTagging) {
        teamsWithScheduledTagging.push(team);
      }
    } catch (error) {
      logger.warn(`获取团队 ${team.name} 的设置失败: ${error}`);
      // 如果获取设置失败，跳过该团队
      continue;
    }
  }

  logger.info(`找到 ${teamsWithScheduledTagging.length} 个启用定时标签的团队`);

  if (teamsWithScheduledTagging.length === 0) {
    return {
      success: true,
      message: "没有团队启用定时标签功能",
      processedTeams: 0,
      totalTeams: 0,
      successCount: 0,
      errorCount: 0,
      results: [],
    };
  }

  const results = [];
  let successCount = 0;
  let errorCount = 0;

  // 遍历每个团队
  for (const team of teamsWithScheduledTagging) {
    try {
      logger.info(`处理团队: ${team.name} (ID: ${team.id})`);

      // 获取团队设置（之前已经验证过的团队）
      const settings = await getTaggingSettings(team.id);

      // 构造请求体
      const requestBody = {
        folderIds: settings.applicationScope.selectedFolders.map((folder) =>
          slugToId("assetFolder", folder.slug),
        ),
        isAll: settings.applicationScope.scopeType === "all",
      };

      logger.info(`调用 ${team.name} 的定时标签 API: ${JSON.stringify(requestBody)}`);

      // 获取团队 API 密钥
      const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });

      // 调用 MuseDAM API
      const result = await requestMuseDAMAPI("/api/muse/timing-tag", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${musedamTeamApiKey}`,
        },
        body: requestBody,
      });
      results.push({
        teamId: team.id,
        teamName: team.name,
        success: true,
        result,
        requestBody,
      });

      successCount++;
      logger.info(`团队 ${team.name} 定时标签任务发起成功`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      logger.error(`团队 ${team.name} 定时标签任务失败: ${errorMessage}`);

      results.push({
        teamId: team.id,
        teamName: team.name,
        success: false,
        error: errorMessage,
        requestBody: null,
      });

      errorCount++;
    }
  }

  const summary = {
    success: true,
    processedTeams: successCount + errorCount,
    successCount,
    errorCount,
    totalTeams: teamsWithScheduledTagging.length,
    results,
  };

  logger.info(`定时标签任务处理完成: ${JSON.stringify(summary)}`);

  return summary;
}
