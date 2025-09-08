// 测试sigmoid公式的分数计算算法

// 权重配置 - 数值越大影响力越大
const WEIGHTS = {
  basicInfo: 1.4, // 最重要 → 最大权重
  materializedPath: 1.2, // 次重要
  contentAnalysis: 1.0, // 第三重要
  tagKeywords: 0.7, // 最不重要但不至于太低
} as const;

type SourceType = keyof typeof WEIGHTS;

interface SourceScores {
  basicInfo?: number;
  materializedPath?: number;
  contentAnalysis?: number;
  tagKeywords?: number;
}

/**
 * 计算多源标签的最终分数 - 使用sigmoid公式
 * @param sources - 各source的分数
 * @returns 最终分数 0-1
 */
function calculateMultiSourceScore(sources: SourceScores = {}): number {
  let weightedSum = 0;

  console.log("计算过程:");
  Object.entries(sources).forEach(([source, confidence]) => {
    if (confidence !== undefined && confidence !== null) {
      const weight = WEIGHTS[source as SourceType];
      const weighted = confidence * weight;
      weightedSum += weighted;
      console.log(`  ${source}: ${confidence} × ${weight} = ${weighted.toFixed(4)}`);
    }
  });

  // sigmoid参数：让单source高confidence接近原值，多source有协同效应
  const steepness = 4; // 控制陡峭度
  const center = 0.8; // 中心点，调整让行为更合理
  
  const finalScore = 1 / (1 + Math.exp(-steepness * (weightedSum - center)));
  
  console.log(`  加权和: ${weightedSum.toFixed(4)}`);
  console.log(`  sigmoid(${steepness}*(${weightedSum.toFixed(4)}-${center})) = ${finalScore.toFixed(4)}`);
  console.log(`  百分制: ${Math.round(finalScore * 100)}分\n`);

  return finalScore;
}

// 测试用例
console.log("=== 多源标签分数计算测试 - sigmoid算法 ===\n");

console.log("1. 目标用例: basicInfo=0.8, contentAnalysis=0.9");
calculateMultiSourceScore({
  basicInfo: 0.8,
  contentAnalysis: 0.9,
});

console.log("2. 单源对比: basicInfo=0.8");
calculateMultiSourceScore({
  basicInfo: 0.8,
});

console.log("3. 单源高confidence: basicInfo=0.9");
calculateMultiSourceScore({
  basicInfo: 0.9,
});

console.log("4. 低权重单源: tagKeywords=0.8");
calculateMultiSourceScore({
  tagKeywords: 0.8,
});

console.log("5. 三源组合: basicInfo=0.7, materializedPath=0.8, contentAnalysis=0.6");
calculateMultiSourceScore({
  basicInfo: 0.7,
  materializedPath: 0.8,
  contentAnalysis: 0.6,
});

console.log("6. 全源命中: 0.6, 0.7, 0.8, 0.5");
calculateMultiSourceScore({
  basicInfo: 0.6,
  materializedPath: 0.7,
  contentAnalysis: 0.8,
  tagKeywords: 0.5,
});

console.log("7. 低confidence测试: basicInfo=0.3, contentAnalysis=0.4");
calculateMultiSourceScore({
  basicInfo: 0.3,
  contentAnalysis: 0.4,
});

console.log("8. 极端情况: basicInfo=1.0, contentAnalysis=1.0");
calculateMultiSourceScore({
  basicInfo: 1.0,
  contentAnalysis: 1.0,
});

console.log("9. 只有低权重源: materializedPath=0.9, tagKeywords=0.9");
calculateMultiSourceScore({
  materializedPath: 0.9,
  tagKeywords: 0.9,
});

console.log("=== 权重影响测试 - 相同分数不同source ===\n");

console.log("10. 都是0.7分数，不同source的权重影响:");
console.log("10a. basicInfo=0.7 (权重1.4，影响力最强)");
calculateMultiSourceScore({
  basicInfo: 0.7,
});

console.log("10b. materializedPath=0.7 (权重1.2)");
calculateMultiSourceScore({
  materializedPath: 0.7,
});

console.log("10c. contentAnalysis=0.7 (权重1.0)");
calculateMultiSourceScore({
  contentAnalysis: 0.7,
});

console.log("10d. tagKeywords=0.7 (权重0.7，影响力最弱)");
calculateMultiSourceScore({
  tagKeywords: 0.7,
});

console.log("11. 都是0.5分数，权重影响对比:");
console.log("11a. basicInfo=0.5");
calculateMultiSourceScore({
  basicInfo: 0.5,
});

console.log("11b. materializedPath=0.5");
calculateMultiSourceScore({
  materializedPath: 0.5,
});

console.log("11c. contentAnalysis=0.5");
calculateMultiSourceScore({
  contentAnalysis: 0.5,
});

console.log("11d. tagKeywords=0.5");
calculateMultiSourceScore({
  tagKeywords: 0.5,
});

console.log("12. 都是0.9分数，权重影响对比:");
console.log("12a. basicInfo=0.9");
calculateMultiSourceScore({
  basicInfo: 0.9,
});

console.log("12b. materializedPath=0.9");
calculateMultiSourceScore({
  materializedPath: 0.9,
});

console.log("12c. contentAnalysis=0.9");
calculateMultiSourceScore({
  contentAnalysis: 0.9,
});

console.log("12d. tagKeywords=0.9");
calculateMultiSourceScore({
  tagKeywords: 0.9,
});

console.log("=== 测试结果汇总表格 ===\n");

// 收集所有测试用例
const testCases = [
  { name: "basicInfo=0.8, contentAnalysis=0.9", basicInfo: 0.8, contentAnalysis: 0.9 },
  { name: "basicInfo=0.8", basicInfo: 0.8 },
  { name: "basicInfo=0.9", basicInfo: 0.9 },
  { name: "tagKeywords=0.8", tagKeywords: 0.8 },
  { name: "三源组合", basicInfo: 0.7, materializedPath: 0.8, contentAnalysis: 0.6 },
  {
    name: "全源命中",
    basicInfo: 0.6,
    materializedPath: 0.7,
    contentAnalysis: 0.8,
    tagKeywords: 0.5,
  },
  { name: "低confidence", basicInfo: 0.3, contentAnalysis: 0.4 },
  { name: "极端情况", basicInfo: 1.0, contentAnalysis: 1.0 },
  { name: "低权重源", materializedPath: 0.9, tagKeywords: 0.9 },
  { name: "basicInfo=0.7", basicInfo: 0.7 },
  { name: "materializedPath=0.7", materializedPath: 0.7 },
  { name: "contentAnalysis=0.7", contentAnalysis: 0.7 },
  { name: "tagKeywords=0.7", tagKeywords: 0.7 },
  { name: "basicInfo=0.5", basicInfo: 0.5 },
  { name: "materializedPath=0.5", materializedPath: 0.5 },
  { name: "contentAnalysis=0.5", contentAnalysis: 0.5 },
  { name: "tagKeywords=0.5", tagKeywords: 0.5 },
  { name: "basicInfo=0.9", basicInfo: 0.9 },
  { name: "materializedPath=0.9", materializedPath: 0.9 },
  { name: "contentAnalysis=0.9", contentAnalysis: 0.9 },
  { name: "tagKeywords=0.9", tagKeywords: 0.9 },
];

// 生成markdown表格
function generateMarkdownTable(): string {
  let table =
    "| 测试用例 | basicInfo (1.4) | materializedPath (1.2) | contentAnalysis (1.0) | tagKeywords (0.7) | 总分 |\n";
  table +=
    "|----------|-----------------|------------------------|----------------------|------------------|------|\n";

  testCases.forEach((testCase) => {
    const { name, basicInfo, materializedPath, contentAnalysis, tagKeywords } = testCase;

    // 静默计算分数
    let weightedSum = 0;
    const sources = { basicInfo, materializedPath, contentAnalysis, tagKeywords };
    Object.entries(sources).forEach(([source, confidence]) => {
      if (confidence !== undefined && confidence !== null) {
        const weight = WEIGHTS[source as SourceType];
        weightedSum += confidence * weight;
      }
    });
    
    const steepness = 4;
    const center = 0.8;
    const finalScore = 1 / (1 + Math.exp(-steepness * (weightedSum - center)));

    // 格式化表格行
    const basicInfoCell = basicInfo !== undefined ? basicInfo.toFixed(1) : "";
    const materializedPathCell = materializedPath !== undefined ? materializedPath.toFixed(1) : "";
    const contentAnalysisCell = contentAnalysis !== undefined ? contentAnalysis.toFixed(1) : "";
    const tagKeywordsCell = tagKeywords !== undefined ? tagKeywords.toFixed(1) : "";
    const totalScoreCell = (finalScore * 100).toFixed(2);

    table += `| ${name} | ${basicInfoCell} | ${materializedPathCell} | ${contentAnalysisCell} | ${tagKeywordsCell} | ${totalScoreCell} |\n`;
  });

  return table;
}

console.log(generateMarkdownTable());

// 导出
export { WEIGHTS, calculateMultiSourceScore, type SourceScores };