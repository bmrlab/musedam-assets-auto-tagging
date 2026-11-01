"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import {
  encodeCsv,
  encodeXlsx,
  parseCsv,
  parseXlsx,
  type BatchFileFormat,
} from "@/app/(tagging)/tagging/batchFile";
import { ServerActionResult } from "@/lib/serverAction";
import { z } from "zod";
import {
  getTagLevelHeaders,
  matrixToTagImportRows,
  nameChildListToBatchText,
  rowsToNameChildList,
} from "./tagImportExport";

export type TagBatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

function encodeTagBatchFile(rows: string[][], format: BatchFileFormat) {
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

function buildInstructionRow(maxLevel: 3 | 4) {
  const levels = maxLevel === 4 ? "一级～四级" : "一级～三级";
  return [
    `每一行一条标签路径，从左到右为${levels}；空单元格表示该级不存在。导入后可在预览中编辑，并选择合并或覆盖。`,
    ...Array(Math.max(0, maxLevel - 1)).fill(""),
  ];
}

function parseMaxLevel(value: unknown): 3 | 4 {
  return value === 4 ? 4 : 3;
}

export async function downloadTagImportTemplateAction(
  format: BatchFileFormat = "xlsx",
  maxLevel: 3 | 4 = 3,
): Promise<ServerActionResult<TagBatchFileResult>> {
  return withAuth(async () => {
    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const level = parseMaxLevel(maxLevel);
      const headers = getTagLevelHeaders(level, false);
      const example = level === 4 ? ["品牌", "Logo", "主视觉", "红色"] : ["品牌", "Logo", "主视觉"];
      const rows = [buildInstructionRow(level), headers, example];
      const { buffer, mimeType } = encodeTagBatchFile(rows, parsedFormat);
      return {
        success: true,
        data: {
          filename: `tag-tree-import-template.${parsedFormat}`,
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "下载模板失败",
      };
    }
  });
}

export async function exportTagTreeFileAction(
  dataRows: string[][],
  format: BatchFileFormat,
  maxLevel: 3 | 4 = 3,
): Promise<ServerActionResult<TagBatchFileResult>> {
  return withAuth(async () => {
    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const level = parseMaxLevel(maxLevel);
      const headers = getTagLevelHeaders(level, false);
      const normalizedRows = dataRows.map((row) => {
        const next = Array(level).fill("");
        row.slice(0, level).forEach((value, index) => {
          next[index] = value ?? "";
        });
        return next;
      });
      const rows = [buildInstructionRow(level), headers, ...normalizedRows];
      const { buffer, mimeType } = encodeTagBatchFile(rows, parsedFormat);
      return {
        success: true,
        data: {
          filename: `tag-tree.${parsedFormat}`,
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "导出失败",
      };
    }
  });
}

/** 解析上传文件，返回可填入批量创建预览的文本。FormData: file + maxLevel */
export async function parseTagImportFileAction(
  formData: FormData,
): Promise<ServerActionResult<{ text: string }>> {
  return withAuth(async () => {
    try {
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return { success: false, message: "请选择文件" };
      }
      const lowerName = file.name.toLowerCase();
      const buffer = Buffer.from(await file.arrayBuffer());
      const matrix = lowerName.endsWith(".csv")
        ? parseCsv(buffer)
        : lowerName.endsWith(".xlsx")
          ? parseXlsx(buffer)
          : null;
      if (!matrix) {
        return { success: false, message: "仅支持 Excel (.xlsx) 或 CSV (.csv) 文件" };
      }
      const level = parseMaxLevel(Number(formData.get("maxLevel")));
      const importRows = matrixToTagImportRows(matrix);
      const tree = rowsToNameChildList(importRows, level);
      const text = nameChildListToBatchText(tree, level);
      if (!text.trim()) {
        return { success: false, message: "未解析到有效标签路径，请检查表头与内容" };
      }
      return { success: true, data: { text } };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "解析文件失败",
      };
    }
  });
}
