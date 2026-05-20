import "server-only";

import {
  buildBatchTemplateRows,
  getBatchHeaders,
  parseBatchRows,
  type BatchColumnDefinition,
  type BatchFileErrorMessages,
  type BatchFileFormat,
} from "../batchFile";
import type { ProductItem } from "./types";

export type ProductBatchFileFormat = BatchFileFormat;

export type ParsedProductBatchRow = {
  rowNumber: number;
  name: string;
  productTypeName: string;
  description: string;
  tagPaths: string;
  imageObjectKeys: string;
  notes: string;
  enabled: string;
};

export type ProductBatchColumnKey =
  | "name"
  | "productTypeName"
  | "description"
  | "tagPaths"
  | "imageObjectKeys"
  | "notes"
  | "enabled";

/** Canonical English headers for templates, exports, and import parsing (all locales). */
export const PRODUCT_BATCH_ENGLISH_HEADERS: Record<ProductBatchColumnKey, string> = {
  name: "Product Name",
  productTypeName: "Product Type",
  description: "Core Feature Description",
  tagPaths: "Linked Tags",
  imageObjectKeys: "Product Image OSS Key",
  notes: "Notes",
  enabled: "Enabled Status",
};

export const PRODUCT_BATCH_ENABLED_VALUES = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const;

const PRODUCT_BATCH_COLUMN_ORDER: ProductBatchColumnKey[] = [
  "name",
  "productTypeName",
  "description",
  "tagPaths",
  "imageObjectKeys",
  "notes",
  "enabled",
];

const REQUIRED_PRODUCT_BATCH_COLUMNS: ProductBatchColumnKey[] = [
  "name",
  "productTypeName",
  "tagPaths",
  "imageObjectKeys",
];

export function getProductBatchColumns() {
  return PRODUCT_BATCH_COLUMN_ORDER.map((key) => ({
    key,
    header: PRODUCT_BATCH_ENGLISH_HEADERS[key],
    aliases: [PRODUCT_BATCH_ENGLISH_HEADERS[key]],
  })) satisfies BatchColumnDefinition<ProductBatchColumnKey>[];
}

export function buildProductBatchExportRows({
  products,
  columns,
}: {
  products: ProductItem[];
  columns: BatchColumnDefinition<ProductBatchColumnKey>[];
}) {
  return [
    getBatchHeaders(columns),
    ...products.map((product) => [
      product.name,
      product.productTypeName,
      product.description,
      product.tags.map((tag) => tag.tagPath.join(" > ")).join("; "),
      product.images.map((image) => image.objectKey).join("; "),
      product.notes,
      product.enabled
        ? PRODUCT_BATCH_ENABLED_VALUES.enabled
        : PRODUCT_BATCH_ENABLED_VALUES.disabled,
    ]),
  ];
}

export function buildProductBatchTemplateRows(
  columns: BatchColumnDefinition<ProductBatchColumnKey>[],
) {
  return buildBatchTemplateRows(columns);
}

export function parseProductBatchRows({
  rows,
  columns,
  fileErrors,
  listSeparator,
  formatMissingRequiredColumns,
}: {
  rows: string[][];
  columns: BatchColumnDefinition<ProductBatchColumnKey>[];
  fileErrors: BatchFileErrorMessages;
  listSeparator: string;
  formatMissingRequiredColumns: (columnNames: string) => string;
}): {
  records: ParsedProductBatchRow[];
  errors: { rowNumber: number; message: string }[];
} {
  return parseBatchRows({
    rows,
    columns,
    fileErrors,
    listSeparator,
    requiredColumns: REQUIRED_PRODUCT_BATCH_COLUMNS,
    formatMissingRequiredColumns,
  });
}
