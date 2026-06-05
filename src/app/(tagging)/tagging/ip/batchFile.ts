import "server-only";

import { getLocalizedBatchColumns } from "../batchColumnTranslations";
import {
  buildBatchTemplateRows,
  getBatchHeaders,
  parseBatchRows,
  type BatchColumnDefinition,
  type BatchFileErrorMessages,
  type BatchFileFormat,
} from "../batchFile";
import type { IpItem } from "./types";

export type IpBatchFileFormat = BatchFileFormat;

export type ParsedIpBatchRow = {
  rowNumber: number;
  name: string;
  ipTypeName: string;
  description: string;
  matchPattern: string;
  tagPaths: string;
  imageObjectKeys: string;
  notes: string;
  enabled: string;
};

export type IpBatchColumnKey =
  | "name"
  | "ipTypeName"
  | "description"
  | "matchPattern"
  | "tagPaths"
  | "imageObjectKeys"
  | "notes"
  | "enabled";

/** Canonical English headers for fallback and backwards-compatible import parsing. */
export const IP_BATCH_ENGLISH_HEADERS: Record<IpBatchColumnKey, string> = {
  name: "IP Character Name",
  ipTypeName: "IP Type",
  description: "Core Feature Description",
  matchPattern: "Match Pattern",
  tagPaths: "Linked Tags",
  imageObjectKeys: "IP Image S3 Key",
  notes: "Notes",
  enabled: "Enabled Status",
};

export const IP_BATCH_ENABLED_VALUES = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const;

export const IP_BATCH_MATCH_PATTERN_VALUES = {
  whole: "Whole",
  partial: "Partial",
} as const;

const IP_BATCH_COLUMN_ORDER: IpBatchColumnKey[] = [
  "name",
  "ipTypeName",
  "description",
  "matchPattern",
  "tagPaths",
  "imageObjectKeys",
  "notes",
  "enabled",
];

const REQUIRED_IP_BATCH_COLUMNS: IpBatchColumnKey[] = [
  "name",
  "ipTypeName",
  "tagPaths",
  "imageObjectKeys",
];

export function getIpBatchColumns() {
  return IP_BATCH_COLUMN_ORDER.map((key) => ({
    key,
    header: IP_BATCH_ENGLISH_HEADERS[key],
    aliases: [IP_BATCH_ENGLISH_HEADERS[key]],
  })) satisfies BatchColumnDefinition<IpBatchColumnKey>[];
}

export function getLocalizedIpBatchColumns() {
  return getLocalizedBatchColumns({
    namespace: "IpLibrary",
    columnKeys: IP_BATCH_COLUMN_ORDER,
    fallbackHeaders: IP_BATCH_ENGLISH_HEADERS,
  });
}

export function buildIpBatchExportRows({
  ips,
  columns,
}: {
  ips: IpItem[];
  columns: BatchColumnDefinition<IpBatchColumnKey>[];
}) {
  return [
    getBatchHeaders(columns),
    ...ips.map((ip) => [
      ip.name,
      ip.ipTypeName,
      ip.description,
      ip.matchPattern === "partial"
        ? IP_BATCH_MATCH_PATTERN_VALUES.partial
        : IP_BATCH_MATCH_PATTERN_VALUES.whole,
      ip.tags.map((tag) => tag.tagPath.join(" > ")).join("; "),
      ip.images.map((image) => image.objectKey).join("; "),
      ip.notes,
      ip.enabled ? IP_BATCH_ENABLED_VALUES.enabled : IP_BATCH_ENABLED_VALUES.disabled,
    ]),
  ];
}

export function buildIpBatchTemplateRows(columns: BatchColumnDefinition<IpBatchColumnKey>[]) {
  return buildBatchTemplateRows(columns);
}

export function parseIpBatchRows({
  rows,
  columns,
  fileErrors,
  listSeparator,
  formatMissingRequiredColumns,
}: {
  rows: string[][];
  columns: BatchColumnDefinition<IpBatchColumnKey>[];
  fileErrors: BatchFileErrorMessages;
  listSeparator: string;
  formatMissingRequiredColumns: (columnNames: string) => string;
}): {
  records: ParsedIpBatchRow[];
  errors: { rowNumber: number; message: string }[];
} {
  return parseBatchRows({
    rows,
    columns,
    fileErrors,
    listSeparator,
    requiredColumns: REQUIRED_IP_BATCH_COLUMNS,
    formatMissingRequiredColumns,
  });
}
