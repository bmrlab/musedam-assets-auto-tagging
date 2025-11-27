/**
 * 从本地 messages 文件同步翻译数据到飞书多维表格
 * 支持多个目录同步到不同的表：
 * - messages/ → AUTO_TAGGING
 * - src/app/(tagging)/messages/ → AUTO_TAGGING_SETTING
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

// 定义目录到表名的映射
const MESSAGES_CONFIG = [
  {
    dir: path.join(__dirname, "..", "messages"),
    tableName: "AUTO_TAGGING",
  },
  {
    dir: path.join(__dirname, "..", "src", "app", "(tagging)", "messages"),
    tableName: "AUTO_TAGGING_SETTING",
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

const getTables = async (tenantAccessToken, appToken) => {
  console.log(chalk.magentaBright(">>> getting tables"));
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`;
  const res = await axios.get(url, {
    params: { page_size: 100 },
    headers: {
      Authorization: "Bearer " + tenantAccessToken,
    },
  });
  console.log(chalk.cyanBright("<<< got tables"));
  return res.data.data.items;
};

const getTableData = async (tenantAccessToken, appToken, tableId) => {
  console.log(chalk.magentaBright(">>> getting existing table data"));
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
    if (items && Array.isArray(items)) {
      allItems = allItems.concat(items);
    }
    pageToken = page_token;
  } while (pageToken);

  console.log(chalk.cyanBright("<<< got all existing table data"));
  return allItems;
};

const deleteRecords = async (tenantAccessToken, appToken, tableId, recordIds) => {
  if (recordIds.length === 0) return;
  console.log(chalk.magentaBright(`>>> deleting ${recordIds.length} records`));
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`;
  await axios.post(
    url,
    {
      records: recordIds,
    },
    {
      headers: {
        Authorization: "Bearer " + tenantAccessToken,
      },
    },
  );
  console.log(chalk.cyanBright("<<< records deleted"));
};

const createOrUpdateTable = async (tenantAccessToken, appToken, namespace, languages) => {
  // 先查找表是否存在
  const tables = await getTables(tenantAccessToken, appToken);
  let targetTable = tables.find((table) => table.name === namespace);

  if (!targetTable) {
    // 表不存在，创建新表
    console.log(chalk.magentaBright(`>>> creating table: ${namespace}`));
    const newTableUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`;

    const newTableRes = await axios.post(
      newTableUrl,
      {
        table: {
          name: namespace,
          default_view_name: "默认的表格视图",
          fields: [
            {
              field_name: "key",
              type: 1,
            },
            ...languages.map((lang) => ({
              field_name: lang,
              type: 1,
            })),
          ],
        },
      },
      {
        headers: {
          Authorization: "Bearer " + tenantAccessToken,
        },
      },
    );
    console.log(chalk.cyanBright(`<<< table created: ${namespace}`));
    targetTable = {
      ...newTableRes.data.data,
      name: namespace,
    };
  } else {
    // 表已存在，检查并添加缺失的语言字段
    console.log(chalk.magentaBright(`>>> table "${namespace}" already exists, checking fields`));
    const fieldsUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${targetTable.table_id}/fields`;
    const fieldsRes = await axios.get(fieldsUrl, {
      headers: {
        Authorization: "Bearer " + tenantAccessToken,
      },
    });

    const existingFields = fieldsRes.data.data.items.map((field) => field.field_name);
    const missingLanguages = languages.filter((lang) => !existingFields.includes(lang));

    if (missingLanguages.length > 0) {
      console.log(
        chalk.yellow(`>>> adding missing language fields: ${missingLanguages.join(", ")}`),
      );
      for (const lang of missingLanguages) {
        await axios.post(
          fieldsUrl,
          {
            field: {
              field_name: lang,
              type: 1, // 文本类型
            },
          },
          {
            headers: {
              Authorization: "Bearer " + tenantAccessToken,
            },
          },
        );
      }
      console.log(chalk.cyanBright("<<< missing fields added"));
    }
  }

  return targetTable;
};

const batchCreateRecords = async (tenantAccessToken, appToken, tableId, records) => {
  if (records.length === 0) return;
  console.log(chalk.magentaBright(`>>> batch creating ${records.length} records`));
  const batchCreateUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`;

  // 分批创建，每批最多 500 条
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await axios.post(
      batchCreateUrl,
      {
        records: batch,
      },
      {
        headers: {
          Authorization: "Bearer " + tenantAccessToken,
        },
      },
    );
  }
  console.log(chalk.cyanBright("<<< batch created records"));
};

// 递归扁平化嵌套的 JSON 对象
const flattenObject = (obj, prefix = "") => {
  const flattened = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // 如果值是对象，递归处理
      Object.assign(flattened, flattenObject(value, newKey));
    } else {
      // 如果值是字符串或其他基本类型，直接使用
      flattened[newKey] = value;
    }
  }
  return flattened;
};

// 同步单个目录到对应的表
async function syncDirectoryToTable(tenantAccessToken, appToken, messagesDir, tableName) {
  console.log(chalk.blueBright(`\n>>> Processing directory: ${messagesDir} → Table: ${tableName}`));

  // 检查目录是否存在
  if (!fs.existsSync(messagesDir)) {
    console.log(chalk.yellow(`⚠️  Directory does not exist: ${messagesDir}, skipping...`));
    return;
  }

  // 读取本地 messages 文件
  const files = fs.readdirSync(messagesDir);
  const jsonFiles = files.filter((file) => file.endsWith(".json"));

  if (jsonFiles.length === 0) {
    console.log(chalk.yellow(`⚠️  No JSON files found in ${messagesDir}, skipping...`));
    return;
  }

  // 收集所有语言和数据
  const allLanguages = [];
  const allKeysData = {}; // { key: { lang: value } }

  for (const file of jsonFiles) {
    const lang = file.replace(".json", "");
    if (!allLanguages.includes(lang)) {
      allLanguages.push(lang);
    }

    const filePath = path.join(messagesDir, file);
    let fileContent = fs.readFileSync(filePath, "utf8").trim();

    // 处理空文件或无效 JSON
    let data = {};
    if (fileContent) {
      try {
        data = JSON.parse(fileContent);
      } catch (error) {
        console.log(
          chalk.yellow(
            `⚠️  Warning: Failed to parse ${file}, using empty object: ${error.message}`,
          ),
        );
        data = {};
      }
    }

    // 扁平化嵌套的 JSON 对象
    const flattenedData = flattenObject(data);

    Object.entries(flattenedData).forEach(([key, value]) => {
      if (!allKeysData[key]) {
        allKeysData[key] = {};
      }
      allKeysData[key][lang] = value;
    });
  }

  console.log(chalk.magentaBright(`>>> Found languages: ${allLanguages.join(", ")}`));
  console.log(chalk.magentaBright(`>>> Found ${Object.keys(allKeysData).length} translation keys`));

  // 创建或更新表
  const table = await createOrUpdateTable(tenantAccessToken, appToken, tableName, allLanguages);

  // 获取现有记录
  const existingRecords = await getTableData(tenantAccessToken, appToken, table.table_id);
  const existingKeysMap = new Map();
  if (existingRecords && Array.isArray(existingRecords)) {
    existingRecords.forEach((record) => {
      if (record && record.fields && record.fields.key) {
        const key = record.fields.key;
        if (key && record.record_id) {
          existingKeysMap.set(key, record.record_id);
        }
      }
    });
  }

  // 删除不存在的 key 的记录
  const keysToDelete = [];
  existingKeysMap.forEach((recordId, key) => {
    if (!allKeysData[key]) {
      keysToDelete.push(recordId);
    }
  });

  if (keysToDelete.length > 0) {
    await deleteRecords(tenantAccessToken, appToken, table.table_id, keysToDelete);
    console.log(chalk.yellow(`>>> Deleted ${keysToDelete.length} obsolete records`));
  }

  // 准备要创建/更新的记录
  const recordsToCreate = [];
  Object.entries(allKeysData).forEach(([key, translations]) => {
    const recordId = existingKeysMap.get(key);
    const fields = {
      key: key,
      ...translations,
    };

    if (recordId) {
      // 更新现有记录
      recordsToCreate.push({
        record_id: recordId,
        fields: fields,
      });
    } else {
      // 创建新记录
      recordsToCreate.push({
        fields: fields,
      });
    }
  });

  // 分批更新/创建记录（飞书 API 限制：更新和创建需要分开处理）
  const recordsToUpdate = recordsToCreate.filter((r) => r.record_id);
  const recordsToInsert = recordsToCreate.filter((r) => !r.record_id);

  if (recordsToInsert.length > 0) {
    await batchCreateRecords(tenantAccessToken, appToken, table.table_id, recordsToInsert);
  }

  // 批量更新现有记录
  if (recordsToUpdate.length > 0) {
    console.log(chalk.magentaBright(`>>> batch updating ${recordsToUpdate.length} records`));
    const batchUpdateUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${table.table_id}/records/batch_update`;
    const batchSize = 500;
    for (let i = 0; i < recordsToUpdate.length; i += batchSize) {
      const batch = recordsToUpdate.slice(i, i + batchSize);
      await axios.post(
        batchUpdateUrl,
        {
          records: batch,
        },
        {
          headers: {
            Authorization: "Bearer " + tenantAccessToken,
          },
        },
      );
    }
    console.log(chalk.cyanBright("<<< batch updated records"));
  }

  console.log(chalk.green(`✅ ${tableName} 表同步完成`));
}

async function main() {
  try {
    const tenantAccessToken = await getTenantAccessToken();

    // 遍历所有配置的目录，分别同步到对应的表
    for (const config of MESSAGES_CONFIG) {
      await syncDirectoryToTable(tenantAccessToken, appToken, config.dir, config.tableName);
    }

    console.log(chalk.green("\n✅ 所有国际化数据已同步到飞书"));
  } catch (error) {
    console.error(chalk.red("❌ 同步失败:"), error);
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
