import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";

/**
 * 标签树表格导入/导出。
 * 每一行是一个标签节点：有 ID 时按 ID 更新；无 ID 时按层级路径创建/合并。
 * 可配置字段：有内容才写入；空单元格保留原值；单独填 `-` 表示清空（描述/关键词）。
 */

/** 文本类可配置字段的清空标记（整格仅为该字符时生效） */
export const TAG_BATCH_CLEAR_VALUE = "-";
/** 导入文件大小上限（不改库表，仅应用层限制） */
export const TAG_BATCH_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 字段回写分片大小 */
export const TAG_BATCH_UPDATE_CHUNK_SIZE = 50;

export const TAG_BATCH_LEVEL_KEYS = ["level1", "level2", "level3", "level4"] as const;
export const TAG_BATCH_FIELD_KEYS = [
  "description",
  "keywords",
  "negativeKeywords",
  "taggingEnabled",
  "siblingsExclusive",
  "requiredGroup",
] as const;

export const TAG_BATCH_COLUMN_KEYS = [
  "id",
  ...TAG_BATCH_LEVEL_KEYS,
  ...TAG_BATCH_FIELD_KEYS,
] as const;

export type TagBatchLevelKey = (typeof TAG_BATCH_LEVEL_KEYS)[number];
export type TagBatchFieldKey = (typeof TAG_BATCH_FIELD_KEYS)[number];
export type TagBatchColumnKey = (typeof TAG_BATCH_COLUMN_KEYS)[number];

const COLUMN_LABELS: Record<TagBatchColumnKey, Record<"zh-CN" | "zh-TW" | "en-US", string>> = {
  id: { "zh-CN": "标签 ID", "zh-TW": "標籤 ID", "en-US": "Tag ID" },
  level1: { "zh-CN": "一级标签", "zh-TW": "一級標籤", "en-US": "Level 1 Tag" },
  level2: { "zh-CN": "二级标签", "zh-TW": "二級標籤", "en-US": "Level 2 Tag" },
  level3: { "zh-CN": "三级标签", "zh-TW": "三級標籤", "en-US": "Level 3 Tag" },
  level4: { "zh-CN": "四级标签", "zh-TW": "四級標籤", "en-US": "Level 4 Tag" },
  description: { "zh-CN": "标签描述", "zh-TW": "標籤描述", "en-US": "Description" },
  keywords: { "zh-CN": "匹配关键词", "zh-TW": "匹配關鍵詞", "en-US": "Matching Keywords" },
  negativeKeywords: { "zh-CN": "排除关键词", "zh-TW": "排除關鍵詞", "en-US": "Excluded Keywords" },
  taggingEnabled: { "zh-CN": "AI 自动打标", "zh-TW": "AI 自動打標", "en-US": "AI Auto Tagging" },
  siblingsExclusive: {
    "zh-CN": "子标签单选",
    "zh-TW": "子標籤單選",
    "en-US": "Exclusive Child Tags",
  },
  requiredGroup: { "zh-CN": "必打标签组", "zh-TW": "必打標籤組", "en-US": "Required Tag Group" },
};

/** 额外表头别名，兼容导出文件被改名后的常见写法 */
const COLUMN_EXTRA_ALIASES: Partial<Record<TagBatchColumnKey, string[]>> = {
  id: ["ID", "id", "标签ID", "標籤ID", "TagID"],
};

const BOOLEAN_ON = new Set([
  "1",
  "true",
  "yes",
  "y",
  "on",
  "enabled",
  "开启",
  "已开启",
  "開啟",
  "已開啟",
  "是",
  "开",
  "開",
]);
const BOOLEAN_OFF = new Set([
  "0",
  "false",
  "no",
  "n",
  "off",
  "disabled",
  "关闭",
  "已关闭",
  "關閉",
  "已關閉",
  "否",
  "关",
  "關",
]);

const TAG_NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 5000;
const KEYWORD_MAX_LENGTH = 100;

export type TagBatchFieldPatch = {
  description?: string;
  keywords?: string[];
  negativeKeywords?: string[];
  taggingEnabled?: boolean;
  siblingsExclusive?: boolean;
  requiredGroup?: boolean;
};

export type ParsedTagBatchRecord = {
  rowNumber: number;
  /** 导出带回的标签 ID；有值时导入按 ID 更新，不走路径新建 */
  id?: number;
  path: string[];
  fields: TagBatchFieldPatch;
};

export type TagBatchParseError = {
  rowNumber: number;
  message: string;
  fatal?: boolean;
};

export type TagBatchCreateNode = {
  name: string;
  nameChildList?: TagBatchCreateNode[];
};

export type TagBatchExportNode = {
  id: number;
  name: string;
  taggingEnabled: boolean;
  extra: unknown;
  children?: TagBatchExportNode[];
};

export type TagBatchMessages = {
  overwriteRequiresValidRows: string;
  conflictingTreeFields: (columns: string) => string;
  duplicateTreeContentMerged: string;
  missingHeader: string;
  missingLevel1: string;
  noDataRows: string;
  nameRequired: string;
  nameTooLong: string;
  descriptionTooLong: string;
  keywordTooLong: string;
  levelGap: (level: number) => string;
  levelExceeded: string;
  booleanInvalid: (column: string) => string;
  idInvalid: string;
  duplicateId: (id: number) => string;
  tagNotFound: string;
  nameExists: string;
  pathMismatch: string;
  duplicateTarget: (rowNumber: number) => string;
  renameSyncFailed: string;
  rowImportFailed: string;
  fileTooLarge: (maxMb: number) => string;
};

type LabelLocale = "zh-CN" | "zh-TW" | "en-US";

export function tagBatchLabelLocale(locale: string): LabelLocale {
  if (locale === "zh-TW") return "zh-TW";
  if (locale.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function tagBatchMessages(locale: string): TagBatchMessages {
  if (tagBatchLabelLocale(locale) === "en-US") {
    return {
      overwriteRequiresValidRows: "Fix all invalid rows before overwriting the tag tree",
      duplicateTreeContentMerged: "Duplicate tag paths and keywords were merged automatically; this does not prevent import",
      conflictingTreeFields: (columns) =>
        `Rows for the same tag path have conflicting settings (${columns}); this row will be skipped if you continue importing`,
      missingHeader: "Missing file header",
      missingLevel1: "File is missing a required column: Level 1 Tag",
      noDataRows: "No importable data found",
      nameRequired: "Level 1 tag is required",
      nameTooLong: "Tag name cannot exceed 100 characters",
      descriptionTooLong: "Description cannot exceed 5000 characters",
      keywordTooLong: "A keyword cannot exceed 100 characters",
      levelGap: (level) => `Level ${level} tag is empty; do not skip levels`,
      levelExceeded: "Exceeds the team tag level limit",
      booleanInvalid: (column) => `${column} only supports: On/Off, true/false, 1/0`,
      idInvalid: "Tag ID must be a positive integer",
      duplicateId: (id) => `Duplicate Tag ID in file: ${id}`,
      tagNotFound: "Tag was not found",
      nameExists: "Tag name already exists at the same level",
      pathMismatch:
        "Level path does not match the tag's current position (moving tags via import is not supported)",
      duplicateTarget: (rowNumber) =>
        `Points to the same tag as row ${rowNumber}; this row was ignored`,
      renameSyncFailed: "Failed to sync the renamed tag to MuseDAM",
      rowImportFailed: "Failed to import this row",
      fileTooLarge: (maxMb) => `Import file cannot exceed ${maxMb}MB`,
    };
  }

  const traditional = tagBatchLabelLocale(locale) === "zh-TW";
  return {
    overwriteRequiresValidRows: traditional
      ? "請修正所有問題行後再覆蓋標籤樹"
      : "请修正所有问题行后再覆盖标签树",
    duplicateTreeContentMerged: traditional
      ? "重複標籤路徑及關鍵詞已自動合併去重，不影響匯入"
      : "重复标签路径及关键词已自动合并去重，不影响导入",
    conflictingTreeFields: (columns) =>
      traditional
        ? `檔案中同一路徑的設定衝突（${columns}），繼續匯入將跳過本行`
        : `文件中同一路径的配置冲突（${columns}），继续导入将跳过本行`,
    missingHeader: traditional ? "檔案缺少表頭" : "文件缺少表头",
    missingLevel1: traditional ? "檔案缺少必填列：一級標籤" : "文件缺少必填列：一级标签",
    noDataRows: traditional ? "未找到可匯入的資料" : "未找到可导入的数据",
    nameRequired: traditional ? "一級標籤不能為空" : "一级标签不能为空",
    nameTooLong: traditional ? "標籤名不能超過 100 個字元" : "标签名不能超过 100 个字符",
    descriptionTooLong: traditional
      ? "標籤描述不能超過 5000 個字元"
      : "标签描述不能超过 5000 个字符",
    keywordTooLong: traditional ? "單個關鍵詞不能超過 100 個字元" : "单个关键词不能超过 100 个字符",
    levelGap: (level) =>
      traditional ? `第${level}級標籤為空，不能跳級填寫` : `第${level}级标签为空，不能跳级填写`,
    levelExceeded: traditional ? "超出目前團隊標籤層級上限" : "超出当前团队标签层级上限",
    booleanInvalid: (column) =>
      traditional
        ? `${column}僅支援：開啟/關閉、true/false、1/0`
        : `${column}仅支持：开启/关闭、true/false、1/0`,
    idInvalid: traditional ? "標籤 ID 必須為正整數" : "标签 ID 必须为正整数",
    duplicateId: (id) => (traditional ? `檔案中標籤 ID 重複：${id}` : `文件中标签 ID 重复：${id}`),
    tagNotFound: traditional ? "未找到對應標籤" : "未找到对应标签",
    nameExists: traditional ? "標籤名在同級中已存在" : "标签名在同级中已存在",
    pathMismatch: traditional
      ? "層級路徑與標籤目前位置不一致（匯入不支援移動標籤）"
      : "层级路径与标签当前位置不一致（导入不支持移动标签）",
    duplicateTarget: (rowNumber) =>
      traditional
        ? `與第 ${rowNumber} 行指向同一標籤，已忽略`
        : `与第 ${rowNumber} 行指向同一标签，已忽略`,
    renameSyncFailed: traditional ? "標籤改名同步到 MuseDAM 失敗" : "标签改名同步到 MuseDAM 失败",
    rowImportFailed: traditional ? "匯入該行失敗" : "导入该行失败",
    fileTooLarge: (maxMb) =>
      traditional ? `匯入檔案不能超過 ${maxMb}MB` : `导入文件不能超过 ${maxMb}MB`,
  };
}

export function tagBatchBooleanLabels(locale: string) {
  return tagBatchLabelLocale(locale) === "en-US"
    ? { on: "On", off: "Off" }
    : tagBatchLabelLocale(locale) === "zh-TW"
      ? { on: "開啟", off: "關閉" }
      : { on: "开启", off: "关闭" };
}

export function getTagBatchColumns(locale: string) {
  const labelLocale = tagBatchLabelLocale(locale);
  return TAG_BATCH_COLUMN_KEYS.map((key) => ({
    key,
    header: COLUMN_LABELS[key][labelLocale],
    aliases: Array.from(
      new Set([...Object.values(COLUMN_LABELS[key]), ...(COLUMN_EXTRA_ALIASES[key] ?? [])]),
    ),
  }));
}

/** Examples are ordinary data rows; the final guidance column is ignored on import. */
export function buildTagBatchTemplateRows(locale: string): string[][] {
  const labelLocale = tagBatchLabelLocale(locale);
  const english = labelLocale === "en-US";
  const traditional = labelLocale === "zh-TW";
  const labels = tagBatchBooleanLabels(locale);
  const root = english ? "Example_Use cases" : traditional ? "範例_適用場景" : "示例_适用场景";
  const notes = english
    ? [
        "Replace or delete example rows before import. All configuration columns are optional. Switches accept On/Off, true/false or 1/0. Child exclusivity and required groups apply to parents with children. Required groups without children are turned off and reported after import.",
        "Blank settings use defaults for new tags and preserve settings for existing tags. Keywords accept ;, Chinese ； or line breaks; commas and enumeration commas are part of the keyword.",
        "Use - alone to clear descriptions or keywords. Keep Tag ID empty for new tags; retain exported IDs to update or rename existing tags. Settings apply to the deepest tag in each row.",
      ]
    : traditional
      ? [
          "匯入前請替換或刪除範例行。設定欄均可選填；開關支援開啟/關閉、true/false、1/0。子標籤單選及必打標籤組適用於有子標籤的父標籤；沒有子標籤時自動關閉必打，匯入完成後提示。",
          "設定留空：新標籤使用預設值，已有標籤保留原值。關鍵詞用英文分號 ;、中文分號 ； 或儲存格內換行分隔；逗號、頓號視為詞的一部分。",
          "描述或關鍵詞單獨填 - 表示清空。新增標籤時 ID 留空；更新或改名時保留匯出的 ID。每行設定套用於該行最末級標籤。",
        ]
      : [
          "导入前请替换或删除示例行。配置列均可选填；开关支持开启/关闭、true/false、1/0。子标签单选及必打标签组适用于有子标签的父标签；没有子标签时自动关闭必打，导入完成后提示。",
          "配置留空：新标签使用默认值，已有标签保留原值。关键词用英文分号 ;、中文分号 ； 或单元格内换行分隔；逗号、顿号视为词的一部分。",
          "描述或关键词单独填 - 表示清空。新增标签时 ID 留空；更新或改名时保留导出的 ID。每行配置应用于该行最末级标签。",
        ];
  return [
    [
      ...getTagBatchColumns(locale).map((column) => column.header),
      english
        ? "Instructions (not imported)"
        : traditional
          ? "填寫說明（不匯入）"
          : "填写说明（不导入）",
    ],
    [
      "",
      root,
      "",
      "",
      "",
      english ? "Select a use case" : traditional ? "選擇適用場景" : "选择适用场景",
      "",
      "",
      labels.on,
      labels.on,
      labels.on,
      notes[0],
    ],
    [
      "",
      root,
      english ? "E-commerce" : traditional ? "電商" : "电商",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      notes[1],
    ],
    [
      "",
      root,
      english ? "Social media" : traditional ? "社群媒體" : "社交媒体",
      "",
      "",
      english ? "Social media assets" : traditional ? "社群宣傳素材" : "社交宣传素材",
      english ? "poster; campaign；launch" : "海报; 活动；新品",
      english ? "draft; internal" : "草稿; 内部",
      labels.on,
      labels.off,
      labels.off,
      notes[2],
    ],
  ];
}

export function parseTagBatchId(value: string): number | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  const normalized = raw.endsWith(".0") ? raw.slice(0, -2) : raw;
  if (!/^\d+$/.test(normalized)) return Number.NaN;
  const id = Number(normalized);
  return Number.isSafeInteger(id) && id > 0 ? id : Number.NaN;
}

export function formatTagBatchBoolean(value: boolean | undefined, locale: string) {
  if (value === undefined) return "";
  const labels = tagBatchBooleanLabels(locale);
  return value ? labels.on : labels.off;
}

export function parseTagBatchBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (BOOLEAN_ON.has(normalized)) return true;
  if (BOOLEAN_OFF.has(normalized)) return false;
  return undefined;
}

export function splitTagBatchKeywords(value: string) {
  const seen = new Set<string>();
  const keywords: string[] = [];
  // 只认分号/换行，和导出一致；逗号、顿号可能是关键词本身的一部分
  for (const part of value.split(/[;\n；]+/g)) {
    const keyword = part.trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
}

/** 仅把「本地尚不存在」的路径行建成树，避免整表推给 MuseDAM */
export function filterMissingPathRecords(
  records: ParsedTagBatchRecord[],
  pathExistsFn: (path: string[]) => boolean,
) {
  return records.filter(
    (record) => record.id === undefined && record.path.length > 0 && !pathExistsFn(record.path),
  );
}

export function joinTagBatchKeywords(keywords: string[] | undefined) {
  return (keywords ?? []).join("; ");
}

export function parseTagBatchTable({
  rows,
  maxLevel,
  ignoreIds = false,
  locale = "zh-CN",
  messages,
}: {
  rows: string[][];
  maxLevel: number;
  ignoreIds?: boolean;
  locale?: string;
  messages?: Partial<TagBatchMessages>;
}): {
  records: ParsedTagBatchRecord[];
  errors: TagBatchParseError[];
} {
  const text = { ...tagBatchMessages(locale), ...messages };
  const levelLimit = Math.min(Math.max(1, maxLevel), MAX_TAG_LEVEL);
  const [headerRow, ...dataRows] = trimTrailingEmptyRows(rows);

  if (!headerRow || headerRow.every((cell) => !cell.trim())) {
    return {
      records: [],
      errors: [{ rowNumber: 1, message: text.missingHeader, fatal: true }],
    };
  }

  const columns = getTagBatchColumns(locale);
  const headerMap = buildHeaderMap(headerRow, columns);
  if (ignoreIds) delete headerMap.id;
  // 无 ID 列时必须有一级标签列，才能按路径新建；有 ID 列则可只靠 ID 更新
  if (headerMap.level1 === undefined && headerMap.id === undefined) {
    return {
      records: [],
      errors: [{ rowNumber: 1, message: text.missingLevel1, fatal: true }],
    };
  }

  const presentFields = new Set<TagBatchFieldKey>(
    TAG_BATCH_FIELD_KEYS.filter((key) => headerMap[key] !== undefined),
  );

  const records: ParsedTagBatchRecord[] = [];
  const errors: TagBatchParseError[] = [];
  const seenIds = new Map<number, number>();
  dataRows.forEach((row, index) => {
    if (row.every((cell) => !String(cell ?? "").trim())) return;
    const rowNumber = index + 2;
    const parsed = parseRow({
      row,
      rowNumber,
      headerMap,
      presentFields,
      columns,
      maxLevel: levelLimit,
      messages: text,
    });
    if ("message" in parsed) {
      errors.push({ rowNumber, message: parsed.message });
      return;
    }
    if (parsed.id !== undefined) {
      const previousRow = seenIds.get(parsed.id);
      if (previousRow !== undefined) {
        errors.push({ rowNumber, message: text.duplicateId(parsed.id) });
        return;
      }
      seenIds.set(parsed.id, rowNumber);
    }
    records.push(parsed);
  });

  if (records.length === 0 && errors.length === 0) {
    return {
      records: [],
      errors: [{ rowNumber: 2, message: text.noDataRows, fatal: true }],
    };
  }

  return { records, errors };
}

/** 同一路径只创建一次，关键词合并去重；其他字段冲突的行单独报错。 */
export function coalesceTagTreeRecords(
  records: ParsedTagBatchRecord[],
  locale: string,
  messages: TagBatchMessages = tagBatchMessages(locale),
): { records: ParsedTagBatchRecord[]; errors: TagBatchParseError[]; warnings: TagBatchParseError[] } {
  const byPath = new Map<string, ParsedTagBatchRecord>();
  const errors: TagBatchParseError[] = [];
  const warnings: TagBatchParseError[] = [];
  const labels = new Map(getTagBatchColumns(locale).map((column) => [column.key, column.header]));
  for (const record of records) {
    const key = JSON.stringify(record.path.map((name) => name.toLowerCase()));
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, { ...record, fields: { ...record.fields } });
      continue;
    }
    const conflicts = TAG_BATCH_FIELD_KEYS.filter((field) => {
      const previous = existing.fields[field];
      const next = record.fields[field];
      if (previous === undefined || next === undefined) return false;
      if (field === "keywords" || field === "negativeKeywords") return false;
      return JSON.stringify(previous) !== JSON.stringify(next);
    });
    if (conflicts.length) {
      errors.push({
        rowNumber: record.rowNumber,
        message: messages.conflictingTreeFields(conflicts.map((field) => labels.get(field)).join("、")),
      });
      continue;
    }
    const fields = { ...record.fields };
    for (const field of ["keywords", "negativeKeywords"] as const) {
      if (existing.fields[field] !== undefined && fields[field] !== undefined) {
        fields[field] = [...new Set([...existing.fields[field]!, ...fields[field]!])];
      }
    }
    Object.assign(existing.fields, fields);
    warnings.push({ rowNumber: record.rowNumber, message: messages.duplicateTreeContentMerged });
  }
  return { records: [...byPath.values()], errors, warnings };
}

/** 仅无 ID 的行参与路径建树；带 ID 的行按 ID 更新，不新建 */
export function tagBatchRecordsToCreateTree(records: ParsedTagBatchRecord[]): TagBatchCreateNode[] {
  const roots: TagBatchCreateNode[] = [];
  for (const record of records) {
    if (record.id !== undefined || record.path.length === 0) continue;
    let siblings = roots;
    record.path.forEach((name, index) => {
      const lowerName = name.toLowerCase();
      let node = siblings.find((item) => item.name.toLowerCase() === lowerName);
      if (!node) {
        node = { name };
        siblings.push(node);
      }
      if (index < record.path.length - 1) {
        node.nameChildList ??= [];
        siblings = node.nameChildList;
      }
    });
  }
  return roots;
}

export function buildTagBatchExportRows({
  tags,
  locale,
}: {
  tags: TagBatchExportNode[];
  locale: string;
}) {
  const columns = getTagBatchColumns(locale);
  const rows = [columns.map((column) => column.header)];
  appendExportNodes(tags, [], rows, locale);
  return rows;
}

export function tagPathLabel(path: string[]) {
  return path.join(" > ");
}

function appendExportNodes(
  nodes: TagBatchExportNode[],
  ancestors: string[],
  rows: string[][],
  locale: string,
) {
  for (const node of nodes) {
    const path = [...ancestors, node.name];
    const extra = readExtra(node.extra);
    const levels = TAG_BATCH_LEVEL_KEYS.map((_, index) => path[index] ?? "");
    rows.push([
      String(node.id),
      ...levels,
      extra.description ?? "",
      joinTagBatchKeywords(extra.keywords),
      joinTagBatchKeywords(extra.negativeKeywords),
      formatTagBatchBoolean(node.taggingEnabled, locale),
      formatTagBatchBoolean(extra.siblingsExclusive, locale),
      formatTagBatchBoolean(extra.requiredGroup, locale),
    ]);
    if (node.children?.length) {
      appendExportNodes(node.children, path, rows, locale);
    }
  }
}

function parseRow({
  row,
  rowNumber,
  headerMap,
  presentFields,
  columns,
  maxLevel,
  messages,
}: {
  row: string[];
  rowNumber: number;
  headerMap: Partial<Record<TagBatchColumnKey, number>>;
  presentFields: Set<TagBatchFieldKey>;
  columns: ReturnType<typeof getTagBatchColumns>;
  maxLevel: number;
  messages: TagBatchMessages;
}): ParsedTagBatchRecord | { message: string } {
  let id: number | undefined;
  if (headerMap.id !== undefined) {
    const parsedId = parseTagBatchId(cell(row, headerMap.id));
    if (parsedId !== undefined && Number.isNaN(parsedId)) {
      return { message: messages.idInvalid };
    }
    id = parsedId;
  }

  const names = TAG_BATCH_LEVEL_KEYS.map((key) => cell(row, headerMap[key]));
  const path: string[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (!name) {
      if (names.slice(index + 1).some(Boolean)) {
        return { message: messages.levelGap(index + 1) };
      }
      break;
    }
    if (name.length > TAG_NAME_MAX_LENGTH) {
      return { message: messages.nameTooLong };
    }
    path.push(name);
  }

  // 带 ID 时可只填可配置字段；无 ID 必须有完整路径用于新建/按路径定位
  if (path.length === 0 && id === undefined) {
    return { message: messages.nameRequired };
  }
  if (path.length > maxLevel) {
    return { message: messages.levelExceeded };
  }

  const fields: TagBatchFieldPatch = {};
  if (presentFields.has("description")) {
    const description = cell(row, headerMap.description);
    if (description === TAG_BATCH_CLEAR_VALUE) {
      fields.description = "";
    } else if (description) {
      if (description.length > DESCRIPTION_MAX_LENGTH) {
        return { message: messages.descriptionTooLong };
      }
      fields.description = description;
    }
  }

  const keywordError = readKeywords(row, headerMap, presentFields, "keywords", fields, messages);
  if (keywordError) return { message: keywordError };
  const negativeError = readKeywords(
    row,
    headerMap,
    presentFields,
    "negativeKeywords",
    fields,
    messages,
  );
  if (negativeError) return { message: negativeError };

  for (const key of ["taggingEnabled", "siblingsExclusive", "requiredGroup"] as const) {
    if (!presentFields.has(key)) continue;
    const raw = cell(row, headerMap[key]);
    if (!raw) continue;
    const parsed = parseTagBatchBoolean(raw);
    if (parsed === undefined) {
      const header = columns.find((column) => column.key === key)?.header ?? key;
      return { message: messages.booleanInvalid(header) };
    }
    fields[key] = parsed;
  }

  return { rowNumber, ...(id !== undefined ? { id } : {}), path, fields };
}

function readKeywords(
  row: string[],
  headerMap: Partial<Record<TagBatchColumnKey, number>>,
  presentFields: Set<TagBatchFieldKey>,
  key: "keywords" | "negativeKeywords",
  fields: TagBatchFieldPatch,
  messages: TagBatchMessages,
) {
  if (!presentFields.has(key)) return null;
  const raw = cell(row, headerMap[key]);
  if (!raw) return null;
  if (raw === TAG_BATCH_CLEAR_VALUE) {
    fields[key] = [];
    return null;
  }
  const keywords = splitTagBatchKeywords(raw);
  if (keywords.some((keyword) => keyword.length > KEYWORD_MAX_LENGTH))
    return messages.keywordTooLong;
  fields[key] = keywords;
  return null;
}

function readExtra(extra: unknown): {
  description?: string;
  keywords?: string[];
  negativeKeywords?: string[];
  siblingsExclusive?: boolean;
  requiredGroup?: boolean;
} {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return {};
  const value = extra as Record<string, unknown>;
  return {
    description: typeof value.description === "string" ? value.description : undefined,
    keywords: stringArray(value.keywords),
    negativeKeywords: stringArray(value.negativeKeywords),
    siblingsExclusive:
      typeof value.siblingsExclusive === "boolean" ? value.siblingsExclusive : undefined,
    requiredGroup: typeof value.requiredGroup === "boolean" ? value.requiredGroup : undefined,
  };
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function cell(row: string[], index: number | undefined) {
  if (index === undefined) return "";
  return String(row[index] ?? "").trim();
}

function buildHeaderMap(headerRow: string[], columns: ReturnType<typeof getTagBatchColumns>) {
  const aliasToKey = new Map<string, TagBatchColumnKey>();
  for (const column of columns) {
    aliasToKey.set(normalizeHeader(column.header), column.key);
    for (const alias of column.aliases) {
      aliasToKey.set(normalizeHeader(alias), column.key);
    }
  }

  const headerMap: Partial<Record<TagBatchColumnKey, number>> = {};
  headerRow.forEach((header, index) => {
    const key = aliasToKey.get(normalizeHeader(header));
    if (key && headerMap[key] === undefined) headerMap[key] = index;
  });
  return headerMap;
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_（）()]+/g, "");
}

function trimTrailingEmptyRows(rows: string[][]) {
  const nextRows = rows.map((row) => row.map((cellValue) => String(cellValue ?? "")));
  while (
    nextRows.length > 0 &&
    nextRows[nextRows.length - 1].every((cellValue) => !cellValue.trim())
  ) {
    nextRows.pop();
  }
  return nextRows;
}
