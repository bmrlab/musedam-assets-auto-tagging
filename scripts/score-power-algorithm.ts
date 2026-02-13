// 权重配置 - 指数越小影响力越大，拉开高低权重差距
const WEIGHTS = {
  basicInfo: 0.7, // 最重要，低指数高影响力
  materializedPath: 0.75, // 次重要
  contentAnalysis: 0.85, // 中等重要，中间位置
  tagKeywords: 0.95, // 最不重要，高指数低影响力
} as const;

type SourceType = keyof typeof WEIGHTS;

interface SourceScores {
  basicInfo?: number;
  materializedPath?: number;
  contentAnalysis?: number;
  tagKeywords?: number;
}

/**
 * 多源标签分数计算 - 多个信息源识别同一标签时增强置信度而非简单平均
 *
 * 设计目的：
 * 解决AI标签预测中当多个不同信息源都识别出同一个标签时，最终分数应该比任何单一源更高，
 * 体现多源验证的价值，而不是简单的加权平均导致分数在各源之间。
 *
 * 核心要求：
 * 1. basicInfo=0.8, contentAnalysis=0.9 希望最终 > 0.9 (90分)
 * 2. 不同源有不同重要性：basicInfo最重要，tagKeywords最不重要
 * 3. 多源协同增强，但要控制增长速度，避免轻易接近满分
 * 4. 数学稳定性：结果在[0,1]范围，多源分数不低于最强单源
 *
 * 算法思路：
 * 尝试了多种方案包括tanh、sigmoid、纯概率独立性，最终选择修正的概率独立性：
 * - 使用指数变换实现权重差异化：confidence^weight，指数越小影响越大
 * - 用降低系数0.8控制协同增长速度：∏(1-aᵢ×0.8) 而非 ∏(1-aᵢ)
 * - 兜底保护：max(协同分数, 最强单源分数)，确保多源不会比单源更差
 *
 * 算法工作原理：
 * 1. 权重调整：每个源的confidence先做指数变换，重要的源指数小影响大
 *    basicInfo: 0.8^0.7 = 0.84，tagKeywords: 0.8^0.95 = 0.81
 *
 * 2. 协同计算：模拟"多个证据同时支持"的概率效应
 *    从1开始，每个源都减少"不匹配"的可能性
 *    但用0.8的系数控制，避免分数过快接近100%
 *
 * 3. 多源优势体现：
 *    - 两个好源组合：basicInfo=0.8 + contentAnalysis=0.9 → 93分（比单独的90分更高）
 *    - 多源验证：越多源认可，最终分数越高，体现"多重验证"的价值
 *
 * 4. 特殊情况处理：
 *    当强势源遇到弱势源（如basicInfo=0.9 + tagKeywords=0.3）时
 *    协同效应可能很小，这时兜底机制保证分数不低于强势源
 *    这符合直觉：一个很确定的证据 + 一个很不确定的证据，不应该随便加分
 */
function calculateScore(sources: SourceScores = {}): number {
  const dampingFactor = 0.8; // 降低独立贡献的系数，防止过快趋向1
  let remaining = 1;
  let maxWeighted = 0; // 记录最强的单source加权值，用于兜底保护

  Object.entries(sources).forEach(([source, confidence]) => {
    if (confidence !== undefined && confidence !== null) {
      const weight = WEIGHTS[source as SourceType];
      const enhanced = Math.pow(confidence, weight); // 权重变换：指数越小影响越大
      maxWeighted = Math.max(maxWeighted, enhanced);

      // 修正的概率独立性：降低每个source的贡献度
      remaining *= 1 - enhanced * dampingFactor;
    }
  });

  const rawScore = 1 - remaining;

  // 兜底保护：确保多源不会比单源更差
  return Math.max(rawScore, maxWeighted);
}

/**
 * 带日志输出的计算函数 - 使用修正的概率独立性算法
 * @param sources - 各source的分数
 * @returns 最终分数 0-1
 */
function calculateMultiSourceScore(sources: SourceScores = {}): number {
  // console.log("修正概率独立性计算过程:");

  const dampingFactor = 0.8;
  let remaining = 1;
  let maxWeighted = 0;

  // console.log("  权重变换 (confidence^weight):");
  Object.entries(sources).forEach(([source, confidence]) => {
    if (confidence !== undefined && confidence !== null) {
      const weight = WEIGHTS[source as SourceType];
      const enhanced = Math.pow(confidence, weight);
      maxWeighted = Math.max(maxWeighted, enhanced);
      remaining *= 1 - enhanced * dampingFactor;
      // console.log(`    ${source}: ${confidence}^${weight} = ${enhanced.toFixed(4)}`);
    }
  });

  const rawScore = 1 - remaining;
  const finalScore = Math.max(rawScore, maxWeighted);

  // console.log(`  修正概率独立性: 1 - ${remaining.toFixed(4)} = ${rawScore.toFixed(4)}`);
  // console.log(`  最强单源: ${maxWeighted.toFixed(4)}`);
  // console.log(
  //   `  最终分数: max(${rawScore.toFixed(4)}, ${maxWeighted.toFixed(4)}) = ${finalScore.toFixed(4)}`,
  // );
  // console.log(`  百分制: ${Math.round(finalScore * 100)}分\n`);

  return finalScore;
}

// 测试用例定义
const testCases = [
  // === 核心功能测试 ===
  { name: "目标用例", basicInfo: 0.8, contentAnalysis: 0.9 },
  { name: "极端情况", basicInfo: 1.0, contentAnalysis: 1.0 },

  // === 单源测试 - 权重影响对比 ===
  { name: "高权重低conf", basicInfo: 0.4 },
  { name: "高权重中conf", basicInfo: 0.7 },
  { name: "高权重高conf", basicInfo: 0.9 },
  { name: "低权重低conf", tagKeywords: 0.4 },
  { name: "低权重中conf", tagKeywords: 0.7 },
  { name: "低权重高conf", tagKeywords: 0.9 },

  // === 双源协同测试 - 相同分数不同组合 ===
  { name: "0.8高+高权重", basicInfo: 0.8, materializedPath: 0.8 },
  { name: "0.8高+中权重", basicInfo: 0.8, contentAnalysis: 0.8 },
  { name: "0.8高+低权重", basicInfo: 0.8, tagKeywords: 0.8 },
  { name: "0.8中+低权重", materializedPath: 0.8, contentAnalysis: 0.8 },
  { name: "0.7各权重组合1", basicInfo: 0.7, materializedPath: 0.7 },
  { name: "0.7各权重组合2", basicInfo: 0.7, contentAnalysis: 0.7 },
  { name: "0.7各权重组合3", materializedPath: 0.7, contentAnalysis: 0.7 },
  { name: "0.7各权重组合4", contentAnalysis: 0.7, tagKeywords: 0.7 },

  // === 三源协同测试 - 相同分数不同权重组合 ===
  { name: "0.5三高权重", basicInfo: 0.5, materializedPath: 0.5, contentAnalysis: 0.5 },
  { name: "0.5高中低权重", basicInfo: 0.5, contentAnalysis: 0.5, tagKeywords: 0.5 },
  { name: "0.5中低权重", materializedPath: 0.5, contentAnalysis: 0.5, tagKeywords: 0.5 },
  { name: "0.6三高权重", basicInfo: 0.6, materializedPath: 0.6, contentAnalysis: 0.6 },
  { name: "0.6高中低权重", basicInfo: 0.6, contentAnalysis: 0.6, tagKeywords: 0.6 },
  { name: "0.6中低权重", materializedPath: 0.6, contentAnalysis: 0.6, tagKeywords: 0.6 },
  { name: "0.7三高权重", basicInfo: 0.7, materializedPath: 0.7, contentAnalysis: 0.7 },
  { name: "0.7高中低权重", basicInfo: 0.7, contentAnalysis: 0.7, tagKeywords: 0.7 },
  { name: "0.8三高权重", basicInfo: 0.8, materializedPath: 0.8, contentAnalysis: 0.8 },
  { name: "0.8高中低权重", basicInfo: 0.8, contentAnalysis: 0.8, tagKeywords: 0.8 },

  // === 四源协同测试 - 少量测试 ===
  { name: "全0.6", basicInfo: 0.6, materializedPath: 0.6, contentAnalysis: 0.6, tagKeywords: 0.6 },
  {
    name: "梯度递减",
    basicInfo: 0.8,
    materializedPath: 0.7,
    contentAnalysis: 0.6,
    tagKeywords: 0.5,
  },

  // === 分数分布测试 - 改为2源和3源 ===
  { name: "高权重集中", basicInfo: 0.9, materializedPath: 0.8 },
  { name: "低权重集中", contentAnalysis: 0.8, tagKeywords: 0.9 },
  { name: "两极分化", basicInfo: 0.9, contentAnalysis: 0.1, tagKeywords: 0.9 },
];

/**
 * 执行所有测试用例
 */
function runAllTests(): void {
  console.log("=== 多源标签分数计算测试 - 修正概率独立性算法 ===\n");

  let index = 1;
  testCases.forEach((testCase) => {
    const { name, basicInfo, materializedPath, contentAnalysis, tagKeywords } = testCase;
    const sources = { basicInfo, materializedPath, contentAnalysis, tagKeywords };

    console.log(`${index}. ${name}`);
    calculateMultiSourceScore(sources);
    index++;
  });
}

/**
 * 生成markdown表格
 */
function generateMarkdownTable(): string {
  let table =
    "| 测试用例 | basicInfo (0.7) | materializedPath (0.75) | contentAnalysis (0.85) | tagKeywords (0.95) | 总分 |\n";
  table +=
    "|----------|-----------------|------------------------|----------------------|------------------|------|\n";

  testCases.forEach((testCase) => {
    const { name, basicInfo, materializedPath, contentAnalysis, tagKeywords } = testCase;
    const sources = { basicInfo, materializedPath, contentAnalysis, tagKeywords };

    // 使用纯计算函数
    const finalScore = calculateScore(sources);

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

// 执行测试
runAllTests();

console.log("=== 测试结果汇总表格 ===\n");
console.log(generateMarkdownTable());

// 导出
export { WEIGHTS, calculateMultiSourceScore, calculateScore, type SourceScores };
