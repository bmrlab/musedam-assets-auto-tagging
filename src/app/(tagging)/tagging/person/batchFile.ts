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
import type { PersonItem } from "./types";

export type PersonBatchFileFormat = BatchFileFormat;

export type ParsedPersonBatchRow = {
  rowNumber: number;
  name: string;
  personTypeName: string;
  tagPaths: string;
  imageObjectKeys: string;
  notes: string;
  enabled: string;
};

export type PersonBatchColumnKey =
  | "name"
  | "personTypeName"
  | "tagPaths"
  | "imageObjectKeys"
  | "notes"
  | "enabled";

/** Canonical English headers for fallback and backwards-compatible import parsing. */
export const PERSON_BATCH_ENGLISH_HEADERS: Record<PersonBatchColumnKey, string> = {
  name: "Person Name",
  personTypeName: "Identity / Role",
  tagPaths: "Linked Tags",
  imageObjectKeys: "Face Photo S3 Key",
  notes: "Notes",
  enabled: "Enabled Status",
};

export const PERSON_BATCH_ENABLED_VALUES = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const;

const PERSON_BATCH_COLUMN_ORDER: PersonBatchColumnKey[] = [
  "name",
  "personTypeName",
  "tagPaths",
  "imageObjectKeys",
  "notes",
  "enabled",
];

const REQUIRED_PERSON_BATCH_COLUMNS: PersonBatchColumnKey[] = [
  "name",
  "personTypeName",
  "tagPaths",
  "imageObjectKeys",
];

export function getPersonBatchColumns() {
  return PERSON_BATCH_COLUMN_ORDER.map((key) => ({
    key,
    header: PERSON_BATCH_ENGLISH_HEADERS[key],
    aliases: [PERSON_BATCH_ENGLISH_HEADERS[key]],
  })) satisfies BatchColumnDefinition<PersonBatchColumnKey>[];
}

export function getLocalizedPersonBatchColumns() {
  return getLocalizedBatchColumns({
    namespace: "PersonLibrary",
    columnKeys: PERSON_BATCH_COLUMN_ORDER,
    fallbackHeaders: PERSON_BATCH_ENGLISH_HEADERS,
  });
}

export function buildPersonBatchExportRows({
  persons,
  columns,
}: {
  persons: PersonItem[];
  columns: BatchColumnDefinition<PersonBatchColumnKey>[];
}) {
  return [
    getBatchHeaders(columns),
    ...persons.map((person) => [
      person.name,
      person.personTypeName,
      person.tags.map((tag) => tag.tagPath.join(" > ")).join("; "),
      person.images.map((image) => image.objectKey).join("; "),
      person.notes,
      person.enabled ? PERSON_BATCH_ENABLED_VALUES.enabled : PERSON_BATCH_ENABLED_VALUES.disabled,
    ]),
  ];
}

export function buildPersonBatchTemplateRows(
  columns: BatchColumnDefinition<PersonBatchColumnKey>[],
) {
  return buildBatchTemplateRows(columns);
}

export function parsePersonBatchRows({
  rows,
  columns,
  fileErrors,
  listSeparator,
  formatMissingRequiredColumns,
}: {
  rows: string[][];
  columns: BatchColumnDefinition<PersonBatchColumnKey>[];
  fileErrors: BatchFileErrorMessages;
  listSeparator: string;
  formatMissingRequiredColumns: (columnNames: string) => string;
}): {
  records: ParsedPersonBatchRow[];
  errors: { rowNumber: number; message: string }[];
} {
  return parseBatchRows({
    rows,
    columns,
    fileErrors,
    listSeparator,
    requiredColumns: REQUIRED_PERSON_BATCH_COLUMNS,
    formatMissingRequiredColumns,
  });
}
