import "server-only";

import prisma from "@/prisma/prisma";

export async function seedTestReviewData(teamId: number) {
  // 创建示例标签层级结构
  const level1Tags = await Promise.all([
    prisma.assetTag.create({
      data: {
        teamId,
        name: "媒体类型",
        level: 1,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "项目分类",
        level: 1,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "颜色",
        level: 1,
      },
    }),
  ]);

  // 创建二级标签
  const level2Tags = await Promise.all([
    prisma.assetTag.create({
      data: {
        teamId,
        name: "图片",
        level: 2,
        parentId: level1Tags[0].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "视频",
        level: 2,
        parentId: level1Tags[0].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "设计素材",
        level: 2,
        parentId: level1Tags[1].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "营销素材",
        level: 2,
        parentId: level1Tags[1].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "蓝色",
        level: 2,
        parentId: level1Tags[2].id,
      },
    }),
  ]);

  // 创建三级标签
  const level3Tags = await Promise.all([
    prisma.assetTag.create({
      data: {
        teamId,
        name: "产品图",
        level: 3,
        parentId: level2Tags[0].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "Banner",
        level: 3,
        parentId: level2Tags[0].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "UI组件",
        level: 3,
        parentId: level2Tags[2].id,
      },
    }),
    prisma.assetTag.create({
      data: {
        teamId,
        name: "海报",
        level: 3,
        parentId: level2Tags[3].id,
      },
    }),
  ]);

  // 创建示例资产对象
  const assets = await Promise.all([
    prisma.assetObject.create({
      data: {
        teamId,
        slug: "product-banner-001",
        materializedPath: "/marketing/banners/product-banner-001.jpg",
        name: "产品发布会海报.jpg",
        description: "新产品发布会的主视觉海报，包含产品图片和活动信息",
        tags: JSON.stringify([]),
        content: JSON.stringify({
          imageAnalysis: {
            colors: ["blue", "white", "gray"],
            objects: ["product", "text", "logo"],
            style: "modern",
          },
          metadata: {
            format: "JPG",
            size: "2.5MB",
            dimensions: "1920x1080",
          },
        }),
      },
    }),
    prisma.assetObject.create({
      data: {
        teamId,
        slug: "running-shoes-photo",
        materializedPath: "/products/shoes/running-shoes-photo.jpg",
        name: "运动鞋户外摄影.jpg",
        description: "专业户外运动鞋产品摄影，展示产品细节和质感",
        tags: JSON.stringify([]),
        content: JSON.stringify({
          imageAnalysis: {
            colors: ["black", "orange", "white"],
            objects: ["shoes", "outdoor", "rocks"],
            style: "photography",
          },
          metadata: {
            format: "JPG",
            size: "3.2MB",
            dimensions: "2560x1440",
          },
        }),
      },
    }),
    prisma.assetObject.create({
      data: {
        teamId,
        slug: "ui-design-mockup",
        materializedPath: "/design/ui/mobile-app-mockup.psd",
        name: "移动应用界面设计.psd",
        description: "移动应用的UI界面设计稿，包含多个页面布局",
        tags: JSON.stringify([]),
        content: JSON.stringify({
          designAnalysis: {
            type: "ui-design",
            platform: "mobile",
            components: ["buttons", "forms", "navigation"],
            colorScheme: "blue-theme",
          },
          metadata: {
            format: "PSD",
            size: "45.6MB",
            layers: 127,
          },
        }),
      },
    }),
  ]);

  // 创建标签预测队列项
  const queueItems = await Promise.all(
    assets.map((asset) =>
      prisma.taggingQueueItem.create({
        data: {
          teamId,
          assetObjectId: asset.id,
          status: "completed",
          startsAt: new Date(Date.now() - 5 * 60 * 1000), // 5分钟前开始
          endsAt: new Date(Date.now() - 2 * 60 * 1000), // 2分钟前结束
          result: JSON.stringify({
            predictions: [
              {
                source: "basicInfo",
                tags: [
                  {
                    confidence: 0.85,
                    leafTagId: level3Tags[0].id,
                    tagPath: ["媒体类型", "图片", "产品图"],
                  },
                ],
              },
            ],
          }),
          extra: JSON.stringify({
            usage: {
              totalTokens: 1250,
              promptTokens: 800,
              completionTokens: 450,
            },
          }),
        },
      }),
    ),
  );

  // 创建审核项目
  const auditItems = [];

  // 为第一个资产创建多个审核项
  auditItems.push(
    ...(await Promise.all([
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[0].id,
          status: "pending",
          confidence: 0.87,
          tagPath: JSON.stringify(["媒体类型", "图片", "产品图"]),
          leafTagId: level3Tags[0].id,
          queueItemId: queueItems[0].id,
        },
      }),
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[0].id,
          status: "pending",
          confidence: 0.72,
          tagPath: JSON.stringify(["项目分类", "营销素材", "海报"]),
          leafTagId: level3Tags[3].id,
          queueItemId: queueItems[0].id,
        },
      }),
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[0].id,
          status: "pending",
          confidence: 0.68,
          tagPath: JSON.stringify(["颜色", "蓝色"]),
          leafTagId: level2Tags[4].id,
          queueItemId: queueItems[0].id,
        },
      }),
    ])),
  );

  // 为第二个资产创建审核项
  auditItems.push(
    ...(await Promise.all([
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[1].id,
          status: "approved",
          confidence: 0.92,
          tagPath: JSON.stringify(["媒体类型", "图片", "产品图"]),
          leafTagId: level3Tags[0].id,
          queueItemId: queueItems[1].id,
        },
      }),
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[1].id,
          status: "rejected",
          confidence: 0.58,
          tagPath: JSON.stringify(["项目分类", "设计素材"]),
          leafTagId: level2Tags[2].id,
          queueItemId: queueItems[1].id,
        },
      }),
    ])),
  );

  // 为第三个资产创建审核项
  auditItems.push(
    ...(await Promise.all([
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[2].id,
          status: "pending",
          confidence: 0.89,
          tagPath: JSON.stringify(["项目分类", "设计素材", "UI组件"]),
          leafTagId: level3Tags[2].id,
          queueItemId: queueItems[2].id,
        },
      }),
      prisma.taggingAuditItem.create({
        data: {
          teamId,
          assetObjectId: assets[2].id,
          status: "pending",
          confidence: 0.75,
          tagPath: JSON.stringify(["颜色", "蓝色"]),
          leafTagId: level2Tags[4].id,
          queueItemId: queueItems[2].id,
        },
      }),
    ])),
  );

  console.log("测试数据创建完成:");
  console.log(`- 创建了 ${level1Tags.length} 个一级标签`);
  console.log(`- 创建了 ${level2Tags.length} 个二级标签`);
  console.log(`- 创建了 ${level3Tags.length} 个三级标签`);
  console.log(`- 创建了 ${assets.length} 个资产对象`);
  console.log(`- 创建了 ${queueItems.length} 个队列项`);
  console.log(`- 创建了 ${auditItems.length} 个审核项`);

  return {
    level1Tags,
    level2Tags,
    level3Tags,
    assets,
    queueItems,
    auditItems,
  };
}

// 清理测试数据
export async function cleanupTestReviewData(teamId: number) {
  await prisma.taggingAuditItem.deleteMany({
    where: { teamId },
  });

  await prisma.taggingQueueItem.deleteMany({
    where: { teamId },
  });

  await prisma.assetObject.deleteMany({
    where: { teamId },
  });

  await prisma.assetTag.deleteMany({
    where: { teamId },
  });

  console.log("测试数据清理完成");
}
