/**
 * 从飞书多维表格同步翻译数据到本地 messages 文件
 * 支持从多个表同步到对应的目录：
 * - AUTO_TAGGING → messages/
 * - AUTO_TAGGING_SETTING → src/app/(tagging)/messages/
 * 支持扁平化的 key (如 namespace.key.subkey) 还原为嵌套的 JSON 对象
 */
import axios from "axios";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const MUSE_FEISHU_APP_ID = process.env.MUSE_FEISHU_APP_ID;
const MUSE_FEISHU_APP_SECRET = process.env.MUSE_FEISHU_APP_SECRET;

const appToken = process.env.MUSE_I18N_TABLE_APP_TOKEN;

// 定义表名到目录的映射
const TABLE_CONFIG = [
  {
    tableName: "AUTO_TAGGING",
    messagesDir: path.join(__dirname, "..", "messages"),
  },
  {
    tableName: "AUTO_TAGGING_SETTING",
    messagesDir: path.join(__dirname, "..", "src", "app", "(tagging)", "messages"),
  },
];

if (!MUSE_FEISHU_APP_ID || !MUSE_FEISHU_APP_SECRET || !appToken) {
  console.error("Environment Variables not set.");
  process.exit(1);
}

const getTenantAccessToken = async () => {
  console.log(chalk.magentaBright(">>> getting tenant access token"));
  const res = await axios.post(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      app_id: MUSE_FEISHU_APP_ID,
      app_secret: MUSE_FEISHU_APP_SECRET,
    },
  );
  const { tenant_access_token } = res.data;
  console.log(chalk.cyanBright("<<< got tenant access token"));
  return tenant_access_token;
};

const getTablesData = async (tenantAccessToken, appToken) => {
  console.log(chalk.magentaBright(">>> getting tables"));
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`;
  const res = await axios.get(url, {
    params: { page_size: 100 },
    headers: {
      Authorization: "Bearer " + tenantAccessToken,
    },
  });
  console.log(chalk.cyanBright("<<< got tables"));
  const tables = res.data.data.items;
  return tables;
};

const getTableData = async (tenantAccessToken, appToken, table) => {
  console.log(chalk.magentaBright(">>> getting table data", chalk.green(table.name)));
  const tableId = table.table_id;
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  let allItems = [];
  let pageToken = "";

  do {
    const res = await axios.get(url, {
      params: {
        page_size: 500,
        page_token: pageToken,
      },
      headers: {
        Authorization: "Bearer " + tenantAccessToken,
      },
    });

    const { items, page_token } = res.data.data;
    allItems = allItems.concat(items);
    pageToken = page_token;
  } while (pageToken);

  console.log(chalk.cyanBright("<<< got all table data", chalk.green(table.name)));
  const tableJson = {};
  for (let index = 0; index < allItems.length; index++) {
    const row = allItems[index];
    const { key, ...rest } = row.fields;
    tableJson[key] = rest;
  }
  return tableJson;
};

const getObjectsDiff = (source, target) => {
  const compareObjects = (src, tgt, currentPath = []) => {
    if (typeof src !== "object" || src === null || typeof tgt !== "object" || tgt === null) {
      if (!Object.is(src, tgt)) {
        return src;
      }
      return undefined;
    }

    let diff = {};
    for (const key of new Set([...Object.keys(src), ...Object.keys(tgt)])) {
      const newPath = [...currentPath, key];
      if (!(key in tgt)) {
        diff[key] = src[key];
        console.log(
          chalk.green(`@@@ New field added, ${newPath.join(".")}: ${JSON.stringify(src[key])}`),
        );
      } else if (!(key in src)) {
        console.log(
          chalk.red(`@@@ Field removed, ${newPath.join(".")}: ${JSON.stringify(tgt[key])}`),
        );
      } else {
        const nestedDiff = compareObjects(src[key], tgt[key], newPath);
        if (nestedDiff !== undefined) {
          diff[key] = nestedDiff;
          console.log(
            chalk.yellow(
              `@@@ Updated field found, ${newPath.join(".")}: ${JSON.stringify(tgt[key])} --> ${JSON.stringify(
                src[key],
              )}`,
            ),
          );
        }
      }
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  };
  return compareObjects(source, target) || {};
};

// 根据 key 更新对象，支持扁平化的 key 还原为嵌套结构
function pathExists(root, parts) {
  if (!parts.length) return false;
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return false;
    }
    if (i === parts.length - 1) {
      return true;
    }
    const next = current[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return false;
    }
    current = next;
  }
  return false;
}

function setExistingPath(root, parts, value) {
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (
      typeof current[parts[i]] !== "object" ||
      current[parts[i]] === null ||
      Array.isArray(current[parts[i]])
    ) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function setNestedPath(root, parts, value) {
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      current[part] = {};
    } else if (
      typeof current[part] !== "object" ||
      current[part] === null ||
      Array.isArray(current[part])
    ) {
      // 如果路径中间有非对象值，需要替换
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function applyTranslation(target, rawKey, value) {
  // 如果 key 直接存在于目标对象中，直接更新
  if (Object.prototype.hasOwnProperty.call(target, rawKey)) {
    target[rawKey] = value;
    return true;
  }

  const parts = rawKey.split(".").filter(Boolean);

  // 如果 key 包含点，尝试作为嵌套路径
  if (parts.length > 1) {
    // 先检查路径是否存在
    if (pathExists(target, parts)) {
      setExistingPath(target, parts, value);
      return true;
    } else {
      // 路径不存在，创建嵌套结构
      setNestedPath(target, parts, value);
      return true;
    }
  }

  // 单层 key，直接设置
  target[rawKey] = value;
  return true;
}

function sortObjectKeys(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return obj;
  }
  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = sortObjectKeys(obj[key]);
    });
  return sorted;
}

function updateI18nFile(lang, tableData, targetMessagesDir) {
  const filePath = path.join(targetMessagesDir, `${lang}.json`);
  let existingData = {};

  // 确保目录存在
  if (!fs.existsSync(targetMessagesDir)) {
    fs.mkdirSync(targetMessagesDir, { recursive: true });
    console.log(chalk.cyanBright(`Created directory: ${targetMessagesDir}`));
  }

  // 读取现有文件内容
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8").trim();
      if (fileContent) {
        existingData = JSON.parse(fileContent);
      }
    }
  } catch (error) {
    console.log(chalk.yellow(`Error reading or parsing file ${lang}.json: ${error.message}`));
    console.log(chalk.yellow("Creating new file or using empty object."));
  }

  const updatedData = JSON.parse(JSON.stringify(existingData));

  Object.entries(tableData).forEach(([key, translations]) => {
    if (!translations || translations[lang] === undefined || translations[lang] === null) {
      return;
    }
    applyTranslation(updatedData, key, translations[lang]);
  });

  // 使用 getObjectsDiff 比较差异
  const diff = getObjectsDiff(updatedData, existingData);

  // 如果有差异，更新文件
  if (Object.keys(diff).length > 0) {
    const sortedJson = sortObjectKeys(updatedData);
    fs.writeFileSync(filePath, JSON.stringify(sortedJson, null, 2) + "\n");
    console.log(chalk.whiteBright(`>>> Updated ${lang}.json with changes`));
  } else {
    console.log(chalk.gray(`No changes for ${lang}.json`));
  }
}

// 从单个表同步到对应的目录
async function syncTableToDirectory(tenantAccessToken, appToken, tableName, messagesDir) {
  console.log(chalk.blueBright(`\n>>> Processing table: ${tableName} → Directory: ${messagesDir}`));

  // 获取所有表格，查找目标表
  const allTables = await getTablesData(tenantAccessToken, appToken);
  const targetTable = allTables.find((table) => table.name === tableName);

  if (!targetTable) {
    console.log(chalk.yellow(`⚠️  Table "${tableName}" not found, skipping...`));
    return;
  }

  console.log(chalk.magentaBright(`>>> Found table: ${tableName}`));

  // 获取表格数据
  const tableData = await getTableData(tenantAccessToken, appToken, targetTable);

  // 收集所有语言（从表格数据中获取所有可能的语言列）
  const allLanguages = new Set();
  Object.values(tableData).forEach((translations) => {
    Object.keys(translations).forEach((lang) => {
      // 排除 key 字段
      if (lang !== "key") {
        allLanguages.add(lang);
      }
    });
  });
  const languages = Array.from(allLanguages);

  console.log(chalk.magentaBright(`>>> Found languages: ${languages.join(", ")}`));

  // 更新所有语言文件
  languages.forEach((lang) => {
    updateI18nFile(lang, tableData, messagesDir);
  });

  console.log(chalk.green(`✅ ${tableName} 表同步完成`));
}

// 主函数
async function main() {
  try {
    const tenantAccessToken = await getTenantAccessToken();

    // 遍历所有配置的表，分别同步到对应的目录
    for (const config of TABLE_CONFIG) {
      await syncTableToDirectory(tenantAccessToken, appToken, config.tableName, config.messagesDir);
    }

    console.log(chalk.green("\n✅ 所有国际化文件已更新"));
  } catch (error) {
    console.error(chalk.red("❌ 更新失败:"), error);
    throw error;
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
