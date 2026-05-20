import "server-only";

import {
  encodeCsv,
  encodeXlsx,
  parseCsv,
  parseXlsx,
  type BrandBatchFileErrorMessages,
  type BrandBatchFileFormat,
} from "./brand/batchFile";

export { encodeCsv, encodeXlsx, parseCsv, parseXlsx };

export type BatchFileFormat = BrandBatchFileFormat;
export type BatchFileErrorMessages = BrandBatchFileErrorMessages;

export type BatchColumnDefinition<TKey extends string = string> = {
  key: TKey;
  header: string;
  aliases: string[];
};

export type BatchParseError = {
  rowNumber: number;
  message: string;
};

export function getBatchHeaders<TKey extends string>(columns: BatchColumnDefinition<TKey>[]) {
  return columns.map((column) => column.header);
}

export function buildBatchTemplateRows<TKey extends string>(
  columns: BatchColumnDefinition<TKey>[],
) {
  return [getBatchHeaders(columns)];
}

export function parseBatchRows<TKey extends string>({
  rows,
  columns,
  requiredColumns,
  fileErrors,
  listSeparator,
  formatMissingRequiredColumns,
}: {
  rows: string[][];
  columns: BatchColumnDefinition<TKey>[];
  requiredColumns: TKey[];
  fileErrors: BatchFileErrorMessages;
  listSeparator: string;
  formatMissingRequiredColumns: (columnNames: string) => string;
}): {
  records: Array<{ rowNumber: number } & Record<TKey, string>>;
  errors: BatchParseError[];
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
  const missingHeaders = requiredColumns.filter((key) => headerMap[key] === undefined);

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
    .map(({ row, rowNumber }) => {
      const values = {} as Record<TKey, string>;

      for (const column of columns) {
        values[column.key] = getCell(row, headerMap[column.key]);
      }

      return {
        rowNumber,
        ...values,
      };
    });

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

export function splitBatchValues(value: string) {
  return value
    .split(/[;\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getBatchFileName(prefix: string, format: BatchFileFormat) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  return `${prefix}-${timestamp}.${format}`;
}

export function encodeBatchFile({ rows, format }: { rows: string[][]; format: BatchFileFormat }) {
  if (format === "csv") {
    return {
      buffer: encodeCsv(rows),
      mimeType: "text/csv;charset=utf-8",
    };
  }

  return {
    buffer: encodeXlsx(rows),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export function parseBatchFile({
  file,
  buffer,
  fileErrors,
  unsupportedFileTypeMessage,
}: {
  file: File;
  buffer: Buffer;
  fileErrors: BatchFileErrorMessages;
  unsupportedFileTypeMessage: string;
}) {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  if (lowerName.endsWith(".csv") || mimeType.includes("csv")) {
    return parseCsv(buffer);
  }

  if (
    lowerName.endsWith(".xlsx") ||
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("excel")
  ) {
    return parseXlsx(buffer, fileErrors);
  }

  throw new Error(unsupportedFileTypeMessage);
}

export function parseImportedEnabled({
  value,
  enabledLabel,
  disabledLabel,
  formatError,
}: {
  value: string;
  enabledLabel: string;
  disabledLabel: string;
  formatError: (enabled: string, disabled: string) => string;
}) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (["true", "1", "yes", "y", "enabled", enabledLabel.toLowerCase()].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "disabled", disabledLabel.toLowerCase()].includes(normalized)) {
    return false;
  }

  throw new Error(formatError(enabledLabel, disabledLabel));
}

function getCell(row: string[], index: number | undefined) {
  if (index === undefined) {
    return "";
  }
  return String(row[index] ?? "").trim();
}

function buildHeaderMap<TKey extends string>(
  headerRow: string[],
  columns: BatchColumnDefinition<TKey>[],
) {
  const headerMap = {} as Partial<Record<TKey, number>>;
  const aliasToKey = new Map<string, TKey>();

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
