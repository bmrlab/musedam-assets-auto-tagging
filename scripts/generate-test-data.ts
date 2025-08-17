#!/usr/bin/env tsx

import { PrismaClient } from "@/prisma/client";

const prisma = new PrismaClient();

interface TagLevel {
  name: string;
  children?: TagLevel[];
}

// 定义3层标签结构
const tagStructure: TagLevel[] = [
  {
    name: "产品类别",
    children: [
      {
        name: "电子产品",
        children: [
          { name: "手机设备" },
          { name: "电脑数码" },
          { name: "智能家居" },
          { name: "音响设备" },
        ],
      },
      {
        name: "服装配饰",
        children: [
          { name: "男装" },
          { name: "女装" },
          { name: "童装" },
          { name: "鞋靴" },
          { name: "包包配饰" },
        ],
      },
      {
        name: "家居用品",
        children: [
          { name: "厨房用具" },
          { name: "卧室用品" },
          { name: "客厅装饰" },
          { name: "收纳整理" },
        ],
      },
      {
        name: "食品饮料",
        children: [
          { name: "零食小食" },
          { name: "饮品茶酒" },
          { name: "生鲜食材" },
          { name: "保健营养" },
        ],
      },
    ],
  },
  {
    name: "媒体类型",
    children: [
      {
        name: "图片素材",
        children: [
          { name: "产品图片" },
          { name: "生活场景" },
          { name: "人物肖像" },
          { name: "背景素材" },
        ],
      },
      {
        name: "视频内容",
        children: [
          { name: "广告视频" },
          { name: "产品展示" },
          { name: "教程演示" },
          { name: "短视频" },
        ],
      },
      {
        name: "文档资料",
        children: [
          { name: "产品手册" },
          { name: "营销文案" },
          { name: "技术文档" },
          { name: "合同协议" },
        ],
      },
      {
        name: "设计文件",
        children: [
          { name: "UI设计" },
          { name: "平面设计" },
          { name: "包装设计" },
          { name: "品牌VI" },
        ],
      },
    ],
  },
];

// 生成素材文件夹路径
const folderPaths = [
  "/营销素材/产品宣传/手机类",
  "/营销素材/产品宣传/服装类",
  "/营销素材/社交媒体/微博",
  "/营销素材/社交媒体/小红书",
  "/设计文件/品牌VI/LOGO",
  "/设计文件/品牌VI/海报",
  "/设计文件/包装设计",
  "/文档资料/产品说明书",
  "/文档资料/市场调研",
  "/视频素材/广告片",
  "/视频素材/产品展示",
  "/图片素材/产品图",
  "/图片素材/lifestyle",
  "/临时文件/待整理",
  "/归档文件/2023年",
];

// 有意义的文件名
const meaningfulNames = [
  "iPhone15_产品海报_春季新品",
  "品牌LOGO_标准版_2024",
  "产品说明书_用户手册_V2.1",
  "社交媒体_小红书_种草文案",
  "广告视频_TVC_30秒版本",
  "包装设计_礼盒装_最终版",
  "市场调研_消费者洞察_Q1",
  "官网首页_轮播图_主视觉",
  "门店物料_海报_A2尺寸",
  "产品摄影_白底图_高清版",
];

// 无意义的文件名
const randomNames = [
  "IMG_20241201_143052",
  "DSC_8492",
  "未命名-1_副本",
  "新建文件夹_temp",
  "Untitled-design-final",
  "copy_of_draft_v3",
  "screenshot_2024_12_01",
  "file_001_backup",
  "temp_export_final2",
  "document_draft_old",
];

async function generateTestData() {
  try {
    console.log("🚀 开始生成测试数据...");

    // 1. 查找或创建team
    console.log("📁 查找或创建团队...");
    let team = await prisma.team.findUnique({
      where: { slug: "t/999" },
    });

    if (!team) {
      team = await prisma.team.create({
        data: {
          name: "测试团队",
          slug: "t/999",
        },
      });
      console.log("✅ 创建了新团队:", team.name);
    } else {
      console.log("✅ 找到已存在团队:", team.name);
    }

    // 2. 生成标签结构
    console.log("🏷️  生成标签结构...");
    const createdTags: any[] = [];

    for (const level1Tag of tagStructure) {
      // 创建一级标签
      const parentTag = await prisma.tag.create({
        data: {
          teamId: team.id,
          name: level1Tag.name,
          level: 1,
          parentId: null,
        },
      });
      createdTags.push(parentTag);

      if (level1Tag.children) {
        for (const level2Tag of level1Tag.children) {
          // 创建二级标签
          const childTag = await prisma.tag.create({
            data: {
              teamId: team.id,
              name: level2Tag.name,
              level: 2,
              parentId: parentTag.id,
            },
          });
          createdTags.push(childTag);

          // 创建三级标签
          if (level2Tag.children) {
            for (const level3Tag of level2Tag.children) {
              const grandChildTag = await prisma.tag.create({
                data: {
                  teamId: team.id,
                  name: level3Tag.name,
                  level: 3,
                  parentId: childTag.id,
                },
              });
              createdTags.push(grandChildTag);
            }
          }
        }
      }
    }

    console.log(`✅ 创建了 ${createdTags.length} 个标签`);

    // 3. 生成AssetObject
    console.log("📄 生成资产对象...");

    for (let i = 0; i < 20; i++) {
      // 生成6位数字的slug
      const assetNumber = String(i + 1).padStart(6, "0");
      const assetSlug = `a/${assetNumber}`;

      // 随机选择文件夹路径
      const materializedPath = folderPaths[Math.floor(Math.random() * folderPaths.length)];

      // 随机选择有意义或无意义的文件名
      const useMeaningfulName = Math.random() > 0.4;
      let name: string;
      if (useMeaningfulName) {
        name = meaningfulNames[Math.floor(Math.random() * meaningfulNames.length)];
      } else {
        name = randomNames[Math.floor(Math.random() * randomNames.length)];
      }

      // 添加随机文件扩展名
      const extensions = [".jpg", ".png", ".pdf", ".mp4", ".psd", ".ai", ".docx", ".xlsx", ".pptx"];
      const extension = extensions[Math.floor(Math.random() * extensions.length)];
      name += extension;

      // 生成描述
      const descriptions = [
        "这是一个重要的营销素材",
        "产品相关的设计文件",
        "市场推广使用的图片",
        "品牌宣传物料",
        "内部使用的文档资料",
        "", // 空描述
        "临时文件，待整理",
        "客户提供的参考素材",
        "设计师制作的创意图片",
        "官方发布的标准素材",
      ];
      const description = descriptions[Math.floor(Math.random() * descriptions.length)];

      // 随机选择2-5个标签，有些可以为空
      let selectedTags: string[] = [];
      const shouldHaveTags = Math.random() > 0.15; // 85%的概率有标签

      if (shouldHaveTags) {
        const tagCount = Math.floor(Math.random() * 4) + 2; // 2-5个标签
        const shuffledTags = [...createdTags].sort(() => Math.random() - 0.5);
        selectedTags = shuffledTags.slice(0, tagCount).map((tag) => tag.name);
      }

      // 创建AssetObject
      const assetObject = await prisma.assetObject.create({
        data: {
          teamId: team.id,
          slug: assetSlug,
          materializedPath,
          name,
          description,
          tags: selectedTags,
          content: {},
        },
      });

      console.log(`✅ 创建资产 ${i + 1}/20: ${assetObject.name}`);
    }

    console.log("🎉 测试数据生成完成！");
    console.log(`📊 统计信息:`);
    console.log(`   - 团队: 1个 (${team.name})`);
    console.log(`   - 标签: ${createdTags.length}个`);
    console.log(`   - 资产对象: 20个`);
  } catch (error) {
    console.error("❌ 生成测试数据失败:", error);
    throw error;
  }
}

async function main() {
  console.log("🧪 MuseDAM 测试数据生成工具\n");

  try {
    await generateTestData();
  } catch (error) {
    console.error("❌ 执行失败:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { generateTestData };
