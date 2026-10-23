#!/usr/bin/env tsx

import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";
import { PrismaClient } from "@/prisma/client";
import * as fs from "fs";
import * as yaml from "js-yaml";
import * as path from "path";

const prisma = new PrismaClient();

interface TagConfig {
  name: string;
  children?: TagConfig[];
}

interface TestDataConfig {
  tags: TagConfig[];
  folder_paths: string[];
  meaningful_names: string[];
  random_names: string[];
  descriptions: {
    meaningful_descriptions: string[];
    simple_descriptions: string[];
    empty_descriptions: string[];
  };
  file_extensions: {
    images: string[];
    videos: string[];
    documents: string[];
    design: string[];
    archives: string[];
  };
  generation_config: {
    total_assets: number;
    meaningful_name_ratio: number;
    meaningful_description_ratio: number;
    empty_description_ratio: number;
    path_name_correlation_ratio: number;
  };
}

// 加载 YAML 配置
function loadTestDataConfig(): TestDataConfig {
  const configPath = path.join(__dirname, "generate-test-data.yaml");
  const yamlContent = fs.readFileSync(configPath, "utf8");
  return yaml.load(yamlContent) as TestDataConfig;
}

// 递归创建标签
async function createTagsRecursively(
  teamId: number,
  tagConfigs: TagConfig[],
  parentId: number | null = null,
  level: number = 1,
  createdTags: any[] = [],
): Promise<any[]> {
  for (const tagConfig of tagConfigs) {
    const tag = await prisma.assetTag.create({
      data: {
        teamId,
        name: tagConfig.name,
        level,
        parentId,
      },
    });

    createdTags.push(tag);

    if (tagConfig.children && tagConfig.children.length > 0) {
      await createTagsRecursively(teamId, tagConfig.children, tag.id, level + 1, createdTags);
    }
  }

  return createdTags;
}

// 随机选择数组中的元素
function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// 根据概率返回 true 或 false
function randomBoolean(probability: number): boolean {
  return Math.random() < probability;
}

// 获取所有文件扩展名
function getAllExtensions(config: TestDataConfig): string[] {
  return [
    ...config.file_extensions.images,
    ...config.file_extensions.videos,
    ...config.file_extensions.documents,
    ...config.file_extensions.design,
    ...config.file_extensions.archives,
  ];
}

// 生成文件名（有关联性或无关联性）
function generateFileName(
  config: TestDataConfig,
  folderPath: string,
  shouldCorrelate: boolean,
): string {
  const useMeaningfulName = randomBoolean(config.generation_config.meaningful_name_ratio);
  const extensions = getAllExtensions(config);
  const extension = randomChoice(extensions);

  let baseName: string;

  if (useMeaningfulName) {
    baseName = randomChoice(config.meaningful_names);

    // 如果需要关联性，尝试匹配文件夹路径
    if (shouldCorrelate) {
      const pathLower = folderPath.toLowerCase();

      // 根据路径调整文件名
      if ((pathLower.includes("服装") || pathLower.includes("clothing")) && Math.random() > 0.3) {
        const clothingNames = config.meaningful_names.filter(
          (name) =>
            name.includes("服装") ||
            name.includes("鞋") ||
            name.includes("包") ||
            name.includes("Nike") ||
            name.includes("AJ") ||
            name.includes("Coach") ||
            name.includes("Air_Jordan") ||
            name.includes("Burberry") ||
            name.includes("Gucci") ||
            name.includes("Prada") ||
            name.includes("sneakers") ||
            name.includes("handbag") ||
            name.includes("trench_coat") ||
            name.includes("shoes"),
        );
        if (clothingNames.length > 0) {
          baseName = randomChoice(clothingNames);
        }
      } else if (
        (pathLower.includes("数码") || pathLower.includes("electronics")) &&
        Math.random() > 0.3
      ) {
        const digitalNames = config.meaningful_names.filter(
          (name) =>
            name.includes("iPhone") ||
            name.includes("华为") ||
            name.includes("小米") ||
            name.includes("Mac") ||
            name.includes("索尼") ||
            name.includes("特斯拉") ||
            name.includes("Huawei") ||
            name.includes("Xiaomi") ||
            name.includes("MacBook") ||
            name.includes("Sony") ||
            name.includes("Tesla") ||
            name.includes("Dyson") ||
            name.includes("vacuum"),
        );
        if (digitalNames.length > 0) {
          baseName = randomChoice(digitalNames);
        }
      } else if (
        (pathLower.includes("美妆") || pathLower.includes("beauty")) &&
        Math.random() > 0.3
      ) {
        const beautyNames = config.meaningful_names.filter(
          (name) =>
            name.includes("SK-II") ||
            name.includes("YSL") ||
            name.includes("兰蔻") ||
            name.includes("海蓝之谜") ||
            name.includes("雅诗兰黛") ||
            name.includes("迪奥") ||
            name.includes("Lancome") ||
            name.includes("La_Mer") ||
            name.includes("Estee_Lauder") ||
            name.includes("Dior") ||
            name.includes("Chanel") ||
            name.includes("lipstick") ||
            name.includes("foundation") ||
            name.includes("perfume") ||
            name.includes("cream"),
        );
        if (beautyNames.length > 0) {
          baseName = randomChoice(beautyNames);
        }
      }
    }
  } else {
    baseName = randomChoice(config.random_names);
  }

  return baseName + extension;
}

// 生成描述
function generateDescription(config: TestDataConfig, fileName: string, folderPath: string): string {
  const meaningfulRatio = config.generation_config.meaningful_description_ratio;
  const emptyRatio = config.generation_config.empty_description_ratio;

  const rand = Math.random();

  if (rand < emptyRatio) {
    return randomChoice(config.descriptions.empty_descriptions);
  } else if (rand < meaningfulRatio + emptyRatio) {
    return randomChoice(config.descriptions.meaningful_descriptions);
  } else {
    return randomChoice(config.descriptions.simple_descriptions);
  }
}

async function generateTestData(teamSlug: string) {
  try {
    console.log("🚀 开始生成测试数据...");

    // 加载配置
    const config = loadTestDataConfig();

    // 1. 查找或创建team
    console.log("📁 查找或创建团队...");
    let team = await prisma.team.findUnique({
      where: { slug: teamSlug },
    });

    if (!team) {
      team = await prisma.team.create({
        data: {
          name: "电商测试团队",
          slug: teamSlug,
        },
      });
      console.log("✅ 创建了新团队:", team.name);
    } else {
      console.log("✅ 找到已存在团队:", team.name);
    }

    // 2. 生成标签结构
    console.log("🏷️  生成标签结构...");
    const createdTags = await createTagsRecursively(team.id, config.tags);
    console.log(`✅ 创建了 ${createdTags.length} 个标签`);

    // 3. 生成AssetObject
    console.log("📄 生成资产对象...");
    const totalAssets = config.generation_config.total_assets;
    const correlationRatio = config.generation_config.path_name_correlation_ratio;

    for (let i = 0; i < totalAssets; i++) {
      // 生成6位随机数字的slug
      const assetNumber = Math.floor(Math.random() * 900000) + 100000;
      const assetSlug = idToSlug("assetObject", new MuseDAMID(assetNumber));

      // 随机选择文件夹路径
      const materializedPath = randomChoice(config.folder_paths);

      // 判断是否需要关联性
      const shouldCorrelate = randomBoolean(correlationRatio);

      // 生成文件名
      const name = generateFileName(config, materializedPath, shouldCorrelate);

      // 生成描述
      const description = generateDescription(config, name, materializedPath);

      // 创建AssetObject（tags字段设为空数组）
      const assetObject = await prisma.assetObject.create({
        data: {
          teamId: team.id,
          slug: assetSlug,
          materializedPath,
          name,
          description,
          tags: [], // 设为空数组
          content: {},
        },
      });

      // 显示进度
      if ((i + 1) % 20 === 0 || i === totalAssets - 1) {
        console.log(`✅ 创建资产 ${i + 1}/${totalAssets}: ${assetObject.name}`);
      }
    }

    console.log("🎉 测试数据生成完成！");
    console.log(`📊 统计信息:`);
    console.log(`   - 团队: 1个 (${team.name})`);
    console.log(`   - 标签: ${createdTags.length}个`);
    console.log(`   - 资产对象: ${totalAssets}个`);

    // 显示标签层级统计
    const countByLevel = new Map<number, number>();
    for (const tag of createdTags) {
      countByLevel.set(tag.level, (countByLevel.get(tag.level) ?? 0) + 1);
    }
    for (const level of [...countByLevel.keys()].sort((a, b) => a - b)) {
      console.log(`   - ${level}级标签: ${countByLevel.get(level)}个`);
    }
  } catch (error) {
    console.error("❌ 生成测试数据失败:", error);
    throw error;
  }
}

async function main() {
  console.log("🧪 MuseDAM 电商行业测试数据生成工具\n");

  // 从命令行参数读取 team slug
  let teamSlug = process.argv[2];
  if (!teamSlug) {
    console.log("ℹ️ 未提供团队 slug 参数，使用默认值: t/test-team-id");
    console.log("用法: tsx scripts/generate-test-data.ts <team-slug>");
    console.log("示例: tsx scripts/generate-test-data.ts t/999");
    teamSlug = "t/test-team-id";
  }

  try {
    await generateTestData(teamSlug);
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
