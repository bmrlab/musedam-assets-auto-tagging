import { NextRequest, NextResponse } from "next/server";

import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { generateCurlCommand, requestMuseDAMAPI } from "@/musedam/lib";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import prisma from "@/prisma/prisma";
import { rootLogger } from "@/lib/logging";
import { slugToId } from "@/lib/slug";

// 日志器
const logger = rootLogger.child({ service: "process-scheduled-tagging" });

// 验证内部 API 密钥
function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.substring(7);
  const internalApiKey = process.env.INTERNAL_API_KEY;
  
  if (!internalApiKey) {
    logger.error("INTERNAL_API_KEY not configured in environment");
    return false;
  }

  return token === internalApiKey;
}

export async function POST(request: NextRequest) {
  try {
    // 验证 API 密钥
    if (!validateApiKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      return NextResponse.json({
        success: true,
        message: "没有团队启用定时标签功能",
        processedTeams: 0,
        totalTeams: 0,
      });
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
          folderIds: settings.applicationScope.selectedFolders.map(folder => slugToId("assetFolder", folder.slug)),
          isAll: settings.applicationScope.scopeType === 'all',
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

    return NextResponse.json(summary);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    logger.error("定时标签任务处理失败: " + errorMessage);

    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}
