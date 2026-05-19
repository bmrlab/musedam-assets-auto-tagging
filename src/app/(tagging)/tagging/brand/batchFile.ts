import "server-only";

import { inflateRawSync } from "node:zlib";

import type { BrandLogoItem } from "./types";

export type BrandBatchFileFormat = "csv" | "xlsx";

export type ParsedBrandBatchRow = {
  rowNumber: number;
  name: string;
  logoTypeName: string;
  tagPaths: string;
  imageObjectKeys: string;
  notes: string;
  enabled: string;
};

export type BrandBatchColumnKey =
  | "name"
  | "logoTypeName"
  | "tagPaths"
  | "imageObjectKeys"
  | "notes"
  | "enabled";

export type BrandBatchColumnDefinition = {
  key: BrandBatchColumnKey;
  header: string;
  aliases: string[];
};

/** Canonical English headers for templates, exports, and import parsing (all locales). */
export const BRAND_BATCH_ENGLISH_HEADERS: Record<BrandBatchColumnKey, string> = {
  name: "Identity Name",
  logoTypeName: "Identity Type",
  tagPaths: "Linked Tags",
  imageObjectKeys: "Identity Image OSS Key",
  notes: "Notes",
  enabled: "Enabled Status",
};

export const BRAND_BATCH_ENABLED_VALUES = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const;

const BRAND_BATCH_COLUMN_ORDER: BrandBatchColumnKey[] = [
  "name",
  "logoTypeName",
  "tagPaths",
  "imageObjectKeys",
  "notes",
  "enabled",
];

const REQUIRED_BRAND_BATCH_COLUMNS: BrandBatchColumnKey[] = [
  "name",
  "logoTypeName",
  "tagPaths",
  "imageObjectKeys",
];

const BRAND_BATCH_COLUMNS: BrandBatchColumnDefinition[] = BRAND_BATCH_COLUMN_ORDER.map((key) => ({
  key,
  header: BRAND_BATCH_ENGLISH_HEADERS[key],
  aliases: [BRAND_BATCH_ENGLISH_HEADERS[key]],
}));

export function getBrandBatchColumns() {
  return BRAND_BATCH_COLUMNS;
}

export type BrandBatchParseError = {
  rowNumber: number;
  message: string;
};

export type BrandBatchFileErrorMessages = {
  missingHeader: string;
  noDataRows: string;
  excelMissingWorksheet: string;
  excelInvalidStructure: string;
  excelUnsupportedCompression: string;
};

const DEFAULT_FILE_ERROR_MESSAGES: BrandBatchFileErrorMessages = {
  missingHeader: "Missing file header",
  noDataRows: "No importable data found",
  excelMissingWorksheet: "Excel file is missing a worksheet",
  excelInvalidStructure: "Invalid Excel file structure",
  excelUnsupportedCompression: "Excel file uses an unsupported compression method",
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

export function getBrandBatchHeaders(columns: BrandBatchColumnDefinition[]) {
  return columns.map((column) => column.header);
}

export function buildBrandBatchExportRows({
  logos,
  columns = getBrandBatchColumns(),
}: {
  logos: BrandLogoItem[];
  columns?: BrandBatchColumnDefinition[];
}) {
  return [
    getBrandBatchHeaders(columns),
    ...logos.map((logo) => [
      logo.name,
      logo.logoTypeName,
      logo.tags.map((tag) => tag.tagPath.join(" > ")).join("; "),
      logo.images.map((image) => image.objectKey).join("; "),
      logo.notes,
      logo.enabled ? BRAND_BATCH_ENABLED_VALUES.enabled : BRAND_BATCH_ENABLED_VALUES.disabled,
    ]),
  ];
}

export function buildBrandBatchTemplateRows(columns: BrandBatchColumnDefinition[] = getBrandBatchColumns()) {
  return [getBrandBatchHeaders(columns)];
}

export function encodeCsv(rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? "");
          if (/[",\r\n]/.test(value)) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
        .join(","),
    )
    .join("\r\n");

  return Buffer.from(`\ufeff${csv}`, "utf8");
}

export function parseCsv(buffer: Buffer) {
  const text = buffer.toString("utf8").replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return trimTrailingEmptyRows(rows);
}

export function parseBrandBatchRows({
  rows,
  columns,
  fileErrors,
  listSeparator,
  formatMissingRequiredColumns,
}: {
  rows: string[][];
  columns: BrandBatchColumnDefinition[];
  fileErrors: BrandBatchFileErrorMessages;
  listSeparator: string;
  formatMissingRequiredColumns: (columnNames: string) => string;
}): {
  records: ParsedBrandBatchRow[];
  errors: BrandBatchParseError[];
} {
  const [headerRow, ...dataRows] = trimTrailingEmptyRows(rows);
  if (!headerRow) {
    return {
      records: [],
      errors: [
        {
          rowNumber: 1,
          message: fileErrors.missingHeader,
        },
      ],
    };
  }

  const headerMap = buildHeaderMap(headerRow, columns);
  const missingHeaders = REQUIRED_BRAND_BATCH_COLUMNS.filter((key) => headerMap[key] === undefined);

  if (missingHeaders.length > 0) {
    const missingHeaderNames = missingHeaders
      .map((key) => columns.find((column) => column.key === key)?.header ?? key)
      .join(listSeparator);
    return {
      records: [],
      errors: [
        {
          rowNumber: 1,
          message: formatMissingRequiredColumns(missingHeaderNames),
        },
      ],
    };
  }

  const records = dataRows
    .map((row, rowIndex) => ({
      row,
      rowNumber: rowIndex + 2,
    }))
    .filter(({ row }) => row.some((cell) => String(cell ?? "").trim().length > 0))
    .map(({ row, rowNumber }) => ({
      rowNumber,
      name: getCell(row, headerMap.name),
      logoTypeName: getCell(row, headerMap.logoTypeName),
      tagPaths: getCell(row, headerMap.tagPaths),
      imageObjectKeys: getCell(row, headerMap.imageObjectKeys),
      notes: getCell(row, headerMap.notes),
      enabled: getCell(row, headerMap.enabled),
    }));

  if (records.length === 0) {
    return {
      records: [],
      errors: [
        {
          rowNumber: 2,
          message: fileErrors.noDataRows,
        },
      ],
    };
  }

  return {
    records,
    errors: [],
  };
}

export function splitBrandBatchValues(value: string) {
  return value
    .split(/[;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function encodeXlsx(rows: string[][]) {
  const files = new Map<string, Buffer>();

  files.set(
    "[Content_Types].xml",
    xmlBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
  );
  files.set(
    "_rels/.rels",
    xmlBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  );
  files.set(
    "xl/workbook.xml",
    xmlBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="BrandLibrary" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
  );
  files.set(
    "xl/_rels/workbook.xml.rels",
    xmlBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
  );
  files.set(
    "xl/styles.xml",
    xmlBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`),
  );
  files.set("xl/worksheets/sheet1.xml", xmlBuffer(buildWorksheetXml(rows)));

  return buildStoredZip(files);
}

export function parseXlsx(
  buffer: Buffer,
  fileErrors: BrandBatchFileErrorMessages = DEFAULT_FILE_ERROR_MESSAGES,
) {
  const files = readZip(buffer, fileErrors);
  const sheetPath = resolveFirstWorksheetPath(files);
  const sheetXml = files.get(sheetPath)?.toString("utf8");

  if (!sheetXml) {
    throw new Error(fileErrors.excelMissingWorksheet);
  }

  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8"));
  return trimTrailingEmptyRows(parseWorksheetRows(sheetXml, sharedStrings));
}

function getCell(row: string[], index: number | undefined) {
  if (index === undefined) {
    return "";
  }
  return String(row[index] ?? "").trim();
}

function buildHeaderMap(headerRow: string[], columns: BrandBatchColumnDefinition[]) {
  const headerMap = {} as Partial<Record<BrandBatchColumnKey, number>>;
  const aliasToKey = new Map<string, BrandBatchColumnKey>();

  for (const column of columns) {
    aliasToKey.set(normalizeHeader(column.header), column.key);
    for (const alias of column.aliases) {
      aliasToKey.set(normalizeHeader(alias), column.key);
    }
  }

  headerRow.forEach((header, index) => {
    const key = aliasToKey.get(normalizeHeader(header));
    if (key && headerMap[key] === undefined) {
      headerMap[key] = index;
    }
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
  const nextRows = rows.map((row) => row.map((cell) => String(cell ?? "")));

  while (
    nextRows.length > 0 &&
    nextRows[nextRows.length - 1].every((cell) => cell.trim().length === 0)
  ) {
    nextRows.pop();
  }

  return nextRows;
}

function xmlBuffer(value: string) {
  return Buffer.from(value.trim(), "utf8");
}

function buildWorksheetXml(rows: string[][]) {
  const xmlRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowNumber}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

function columnName(columnIndex: number) {
  let value = "";
  let index = columnIndex + 1;

  while (index > 0) {
    const remainder = (index - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    index = Math.floor((index - 1) / 26);
  }

  return value;
}

function columnIndex(ref: string) {
  const letters = ref.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&amp;/g, "&");
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files: Map<string, Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [fileName, data] of files) {
    const fileNameBuffer = Buffer.from(fileName, "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(fileNameBuffer.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileNameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(fileNameBuffer.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, fileNameBuffer);

    offset += localHeader.byteLength + fileNameBuffer.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.size, 8);
  endRecord.writeUInt16LE(files.size, 10);
  endRecord.writeUInt32LE(centralDirectory.byteLength, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function readZip(buffer: Buffer, fileErrors: BrandBatchFileErrorMessages) {
  const files = new Map<string, Buffer>();
  const endRecordOffset = findEndOfCentralDirectory(buffer, fileErrors);
  const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endRecordOffset + 16);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(fileErrors.excelInvalidStructure);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      files.set(fileName, compressedData);
    } else if (compressionMethod === 8) {
      files.set(fileName, inflateRawSync(compressedData));
    } else {
      throw new Error(fileErrors.excelUnsupportedCompression);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(buffer: Buffer, fileErrors: BrandBatchFileErrorMessages) {
  for (let offset = buffer.byteLength - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error(fileErrors.excelInvalidStructure);
}

function resolveFirstWorksheetPath(files: Map<string, Buffer>) {
  const workbookXml = files.get("xl/workbook.xml")?.toString("utf8");
  const workbookRelsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const firstSheetRelId = workbookXml?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];

  if (firstSheetRelId && workbookRelsXml) {
    const relRegex = /<Relationship\b([^>]*?)\/?>/g;
    for (const match of workbookRelsXml.matchAll(relRegex)) {
      const attrs = match[1];
      if (getXmlAttr(attrs, "Id") !== firstSheetRelId) {
        continue;
      }

      const target = getXmlAttr(attrs, "Target");
      if (!target) {
        break;
      }

      return target.startsWith("/")
        ? target.replace(/^\//, "")
        : `xl/${target.replace(/^\.\//, "")}`;
    }
  }

  return "xl/worksheets/sheet1.xml";
}

function parseSharedStrings(xml: string | undefined) {
  if (!xml) {
    return [];
  }

  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""),
  );
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;

  for (const rowMatch of xml.matchAll(rowRegex)) {
    const rowNumber = Number(getXmlAttr(rowMatch[1], "r")) || rows.length + 1;
    const row: string[] = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

    for (const cellMatch of rowMatch[2].matchAll(cellRegex)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = getXmlAttr(attrs, "r");
      const index = ref ? columnIndex(ref) : row.length;
      row[index] = parseCellValue(attrs, body, sharedStrings);
    }

    rows[rowNumber - 1] = row;
  }

  return rows.map((row) => row ?? []);
}

function parseCellValue(attrs: string, body: string, sharedStrings: string[]) {
  const type = getXmlAttr(attrs, "t");

  if (type === "inlineStr") {
    return Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => decodeXml(match[1]))
      .join("");
  }

  const rawValue = decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "");

  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  if (type === "b") {
    return rawValue === "1" ? "TRUE" : "FALSE";
  }

  return rawValue;
}

function getXmlAttr(attrs: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attrs.match(new RegExp(`\\b${escapedName}="([^"]*)"`))?.[1];
}
