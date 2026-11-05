"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { pruneRejectionCountsForRemovedKeywords } from "@/app/(tagging)/keyword-feedback";
import {
  encodeBatchFile,
  getBatchFileName,
  parseBatchFile,
  type BatchFileFormat,
} from "@/app/(tagging)/tagging/batchFile";
import type { ServerActionResult } from "@/lib/serverAction";
import { applyTagConfigImportChunk } from "@/lib/tagging/import-tag-config";
import {
  assertTagImportOwnership,
  runTagImportExclusive,
  TagImportBusyError,
} from "@/lib/tagging/tag-import-lock";
import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import type { AssetTagExtra, Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { batchCreateTags, saveTagsTreeToMuseDAM } from "./actions";
import {
  buildTagBatchExportRows,
  coalesceTagTreeRecords,
  buildTagBatchTemplateRows,
  filterMissingPathRecords,
  parseTagBatchTable,
  TAG_BATCH_MAX_FILE_BYTES,
  TAG_BATCH_UPDATE_CHUNK_SIZE,
  tagBatchMessages,
  tagBatchRecordsToCreateTree,
  tagPathLabel,
  type ParsedTagBatchRecord,
  type TagBatchCreateNode,
  type TagBatchExportNode,
  type TagBatchFieldPatch,
  type TagBatchMessages,
} from "./tagBatchSpreadsheet";
import type { TagNode } from "./types";

export type TagTreeBatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type TagTreeBatchImportResult = {
  /** 已成功导入，但因无直接子标签而自动关闭必打的标签路径。 */
  autoDisabledRequiredGroups?: string[];
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: Array<{
    rowNumber: number;
    name: string | null;
    message: string;
  }>;
};

type TagRow = {
  id: number;
  name: string;
  slug: string | null;
  parentId: number | null;
  extra: Prisma.JsonValue;
  taggingEnabled: boolean;
};

export type TagTreeImportPrecheck = {
  reviewable?: boolean;
  /** 上传树的节点数，不区分新增与复用。 */
  importableCount?: number;
  previewTree?: TagBatchCreateNode[];
  /** 兼容通用预检结构；文件预览不计算相对旧树的变更量。 */
  createCount: number;
  createPaths: string[];
  updateCount: number;
  renameCount: number;
  unchangedCount: number;
  /** 正式导入时会被跳过的行 */
  issues: ImportFailure[];
  /** 已自动合并的重复内容，不应作为跳过行或阻止导入的依据。 */
  warnings?: ImportFailure[];
};

type ImportFailure = TagTreeBatchImportResult["failures"][number];

type PreparedImport =
  | { kind: "error"; message: string }
  | { kind: "fatal"; failures: ImportFailure[]; skippedCount?: number }
  | {
      kind: "ready";
      prepared: PreparedUpdate[];
      failures: ImportFailure[];
      noopSuccessCount: number;
      skippedCount: number;
      idIndex: Map<number, TagRow>;
      createCount: number;
      createPaths: string[];
      previewTree: TagBatchCreateNode[];
    };

type PreparedUpdate = {
  importAncestorIds?: number[];
  autoDisabledRequiredGroup?: boolean;
  record: ParsedTagBatchRecord;
  tag: TagRow;
  data: {
    name?: string;
    taggingEnabled?: boolean;
    extra?: AssetTagExtra;
  };
};

export async function exportTagTreeAction(
  format: BatchFileFormat,
  maxLevel: 3 | 4 = 4,
): Promise<ServerActionResult<TagTreeBatchFileResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const locale = await getLocale();
    const t = await getTranslations("Tagging.BatchImportExport");
    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const tags = limitTagTreeDepth(await loadTagTree(teamId), maxLevel === 3 ? 3 : 4);
      const rows = buildTagBatchExportRows({ tags, locale });
      return fileResult("tag-tree", parsedFormat, rows);
    } catch (error) {
      console.error("Failed to export tag tree:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("exportFailed"),
      };
    }
  });
}

export async function downloadTagTreeImportTemplateAction(
  format: BatchFileFormat = "xlsx",
): Promise<ServerActionResult<TagTreeBatchFileResult>> {
  return withAuth(async () => {
    const locale = await getLocale();
    const t = await getTranslations("Tagging.BatchImportExport");
    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const rows = buildTagBatchTemplateRows(locale);
      return fileResult("tag-tree-template", parsedFormat, rows);
    } catch (error) {
      console.error("Failed to build tag tree import template:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("templateDownloadFailed"),
      };
    }
  });
}

/** 仅校验和预览上传的标签树，不读取旧树，不依赖合并/覆盖模式。 */
export async function precheckTagTreeImportAction(
  formData: FormData,
): Promise<ServerActionResult<TagTreeImportPrecheck>> {
  return withAuth(async () => {
    const t = await getTranslations("Tagging.BatchImportExport");
    try {
      // Preview only the uploaded tree: no database lookup, import mode or writes.
      const uploaded = await readUploadedTagTree(formData, true);
      if (uploaded.kind === "error") return { success: false, message: uploaded.message };
      const records = uploaded.records.filter((record) => record.path.length > 0);
      const pathErrors = uploaded.records.filter((record) => !record.path.length).map((record) => ({
        rowNumber: record.rowNumber, name: null, message: uploaded.messages.nameRequired,
      }));
      const combined = coalesceTagTreeRecords(records.map((record) => ({ ...record, id: undefined })), uploaded.locale, uploaded.messages);
      const tree = tagBatchRecordsToCreateTree(combined.records);
      const paths = collectNewTagPaths(tree, buildTagLookup([]));
      return {
        success: true,
        data: {
          reviewable: true,
          previewTree: tree,
          importableCount: paths.length,
          createCount: 0,
          createPaths: [],
          updateCount: 0,
          renameCount: 0,
          unchangedCount: 0,
          issues: [...toFailures(uploaded.errors), ...pathErrors, ...toFailures(combined.errors)],
          warnings: toFailures(combined.warnings),
        },
      };
    } catch (error) {
      console.error("Failed to precheck tag tree import:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("importFailed"),
      };
    }
  });
}

export async function importTagTreeAction(
  formData: FormData,
): Promise<ServerActionResult<TagTreeBatchImportResult>> {
  return withAuth(async ({ user, team: { id: teamId } }) => {
    const locale = await getLocale();
    const t = await getTranslations("Tagging.BatchImportExport");
    const messages = tagBatchMessages(locale);

    try {
      return await runTagImportExclusive<ServerActionResult<TagTreeBatchImportResult>>(
        teamId,
        user.id,
        async () => {
          // Validate the original file before any mutation. If it both renames a
          // parent and adds descendants, persist accepted renames first so creation
          // resolves those descendants to the original parent ID.
          const preflight = await prepareTagTreeImport(teamId, formData, true);
          if (preflight.kind === "ready" && preflight.createCount > 0) {
            const renames = preflight.prepared.filter((item) => item.data.name);
            if (renames.length > 0) {
              const synced = await saveTagsTreeToMuseDAM(
                buildRenameSyncTree(renames, preflight.idIndex),
              );
              if (!synced.success) {
                const failures = [
                  ...preflight.failures,
                  ...renames.map((item) => ({
                    rowNumber: item.record.rowNumber,
                    name: item.tag.name,
                    message: synced.message || messages.renameSyncFailed,
                  })),
                ];
                return {
                  success: true,
                  data: {
                    successCount: 0,
                    failedCount: failures.length,
                    skippedCount: 0,
                    failures,
                  },
                };
              }
              await prisma.$transaction(async (tx) => {
                await assertTagImportOwnership(tx);
                await Promise.all(
                  renames.map((item) =>
                    tx.assetTag.update({
                      where: { id: item.tag.id, teamId },
                      data: { name: item.data.name },
                    }),
                  ),
                );
              });
            }
          }
          const outcome = await prepareTagTreeImport(teamId, formData, false);
          if (outcome.kind === "error") return { success: false, message: outcome.message };
          if (outcome.kind === "fatal") {
            return {
              success: true,
              data: {
                successCount: 0,
                failedCount: outcome.failures.length,
                skippedCount: outcome.skippedCount ?? 0,
                failures: outcome.failures,
              },
            };
          }
          const { prepared, failures, noopSuccessCount, idIndex } = outcome;

          const autoDisabledIds = new Set(
            prepared.filter((item) => item.autoDisabledRequiredGroup).map((item) => item.tag.id),
          );
          const autoDisabledTags: TagRow[] = [];

          // 改名先推 MuseDAM，保持两端名称一致；同步失败的行不回写本地。
          const renamedInMuseDAM = prepared.filter((item) => item.data.name && item.tag.slug);
          if (renamedInMuseDAM.length > 0) {
            const synced = await saveTagsTreeToMuseDAM(
              buildRenameSyncTree(renamedInMuseDAM, idIndex),
            );
            if (!synced.success) {
              const message = synced.message
                ? `${messages.renameSyncFailed}: ${synced.message}`
                : messages.renameSyncFailed;
              const failedItems = new Set(renamedInMuseDAM);
              for (const item of renamedInMuseDAM) {
                failures.push({
                  rowNumber: item.record.rowNumber,
                  name: item.record.id !== undefined ? `ID ${item.record.id}` : item.tag.name,
                  message,
                });
              }
              prepared.splice(
                0,
                prepared.length,
                ...prepared.filter((item) => !failedItems.has(item)),
              );
            }
          }

          let successCount = noopSuccessCount;
          for (const chunk of chunkArray(prepared, TAG_BATCH_UPDATE_CHUNK_SIZE)) {
            try {
              await prisma.$transaction((tx) => applyTagConfigImportChunk(tx, teamId, chunk));
              for (const item of chunk) {
                applyPreparedUpdateLocally(item);
                if (autoDisabledIds.has(item.tag.id)) autoDisabledTags.push(item.tag);
                successCount += 1;
              }
            } catch (error) {
              console.error("Failed to import tag chunk:", error);
              // 分片失败时降级逐行，尽量保住其余行
              for (const item of chunk) {
                try {
                  await prisma.$transaction((tx) => applyTagConfigImportChunk(tx, teamId, [item]));
                  applyPreparedUpdateLocally(item);
                  if (autoDisabledIds.has(item.tag.id)) autoDisabledTags.push(item.tag);
                  successCount += 1;
                } catch (rowError) {
                  console.error("Failed to import tag row:", rowError);
                  failures.push({
                    rowNumber: item.record.rowNumber,
                    name:
                      item.record.id !== undefined
                        ? `ID ${item.record.id}`
                        : tagPathLabel(item.record.path) || item.tag.name,
                    message:
                      rowError instanceof Error ? rowError.message : messages.rowImportFailed,
                  });
                }
              }
            }
          }

          return {
            success: true,
            data: {
              successCount,
              autoDisabledRequiredGroups: [
                ...new Set(
                  autoDisabledTags.map((tag) =>
                    tagPathLabel(tagAncestry(tag, idIndex).map((ancestor) => ancestor.name)),
                  ),
                ),
              ],
              failedCount: failures.length,
              skippedCount: outcome.skippedCount,
              failures,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof TagImportBusyError)
        return {
          success: false,
          code: "busy",
          message: t("memberImportInProgress", { name: error.memberName }),
        };
      console.error("Failed to import tag tree:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("importFailed"),
      };
    }
  });
}

/** 读取文件并校验其自身结构和字段；旧 ID 在标签树导入中不参与定位。 */
async function readUploadedTagTree(formData: FormData, ignoreIds = false) {
  const locale = await getLocale();
  const t = await getTranslations("Tagging.BatchImportExport");
  const messages = {
    ...tagBatchMessages(locale),
    missingHeader: t("fileErrors.missingHeader"),
    noDataRows: t("fileErrors.noDataRows"),
  };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return { kind: "error" as const, message: t("selectImportFile") };
  }
  if (file.size > TAG_BATCH_MAX_FILE_BYTES) {
    return {
      kind: "error" as const,
      message: messages.fileTooLarge(TAG_BATCH_MAX_FILE_BYTES / (1024 * 1024)),
    };
  }

  const maxLevel = formData.get("tagLevel") === "4" ? 4 : 3;
  const buffer = Buffer.from(await file.arrayBuffer());
  const tableRows = parseBatchFile({
    file,
    buffer,
    fileErrors: {
      missingHeader: t("fileErrors.missingHeader"),
      noDataRows: t("fileErrors.noDataRows"),
      excelMissingWorksheet: t("fileErrors.excelMissingWorksheet"),
      excelInvalidStructure: t("fileErrors.excelInvalidStructure"),
      excelUnsupportedCompression: t("fileErrors.excelUnsupportedCompression"),
    },
    unsupportedFileTypeMessage: t("unsupportedFileType"),
  });
  const parsed = parseTagBatchTable({
    rows: tableRows,
    ignoreIds,
    maxLevel,
    locale,
    messages,
  });

  return { kind: "parsed" as const, ...parsed, messages, locale };
}

/** 执行阶段才匹配已有标签；dryRun 用于写入前再次校验，不用于页面预览。 */
async function prepareTagTreeImport(
  teamId: number,
  formData: FormData,
  dryRun: boolean,
): Promise<PreparedImport> {
  const uploaded = await readUploadedTagTree(formData, formData.get("treeImport") === "true");
  if (uploaded.kind === "error") return uploaded;
  const { locale, messages } = uploaded;
  const maxLevel = formData.get("tagLevel") === "4" ? 4 : 3;
  const parsed = { records: uploaded.records, errors: uploaded.errors };
  const treeImport = formData.get("treeImport") === "true";
  if (parsed.errors.some((error) => error.fatal)) {
    return { kind: "fatal", failures: toFailures(parsed.errors) };
  }
  const requestedSkips = !formData.get("skipRows")
    ? []
    : z.array(z.number().int().min(2)).parse(JSON.parse(String(formData.get("skipRows"))));
  const skippedRows = new Set(
    requestedSkips.filter(
      (row) =>
        parsed.records.some((record) => record.rowNumber === row) || parsed.errors.some((error) => error.rowNumber === row),
    ),
  );
  parsed.records = parsed.records.filter((record) => !skippedRows.has(record.rowNumber));
  parsed.errors = parsed.errors.filter((error) => !skippedRows.has(error.rowNumber));
  if (treeImport) {
    const missingPaths = parsed.records.filter((record) => !record.path.length);
    if (missingPaths.length) return {
      kind: "fatal", failures: missingPaths.map((record) => ({ rowNumber: record.rowNumber, name: null, message: messages.nameRequired })),
    };
    const combined = coalesceTagTreeRecords(parsed.records.map((record) => ({ ...record, id: undefined })), locale, messages);
    parsed.records = combined.records;
    parsed.errors.push(...combined.errors);
    if (parsed.errors.length) return { kind: "fatal", failures: toFailures(parsed.errors) };
  }
  if (parsed.records.length === 0) {
    return { kind: "fatal", failures: toFailures(parsed.errors), skippedCount: skippedRows.size };
  }

  const importMode = z.enum(["merge", "overwrite"]).parse(formData.get("importMode") || "merge");
  // Legacy callers cannot overwrite a partial file. The tree preview flow may
  // explicitly acknowledge skipped rows; remaining unacknowledged errors were rejected above.
  if (!treeImport && importMode === "overwrite" && (parsed.errors.length > 0 || skippedRows.size > 0)) {
    return {
      kind: "fatal",
      failures: toFailures(
        parsed.errors.length
          ? parsed.errors
          : [{ rowNumber: 1, message: messages.overwriteRequiresValidRows }],
      ),
    };
  }
  let tags = await loadTeamTagRows(teamId);
  let lookup = buildTagLookup(tags);

  // 路径名大小写对齐到已有标签，避免 batchCreateTags（精确匹配）新建出仅大小写不同的同级标签
  // Exported IDs refer to the old tree. Resolve paths before replacement, then
  // discard those IDs so configuration is applied to the newly created tags.
  if (importMode === "overwrite") {
    const existingById = indexTagsById(tags);
    const invalid: ImportFailure[] = [];
    parsed.records = parsed.records.map((record) => {
      const existing = record.id !== undefined ? existingById.get(record.id) : undefined;
      if (record.id !== undefined && !existing) {
        invalid.push({
          rowNumber: record.rowNumber,
          name: `ID ${record.id}`,
          message: messages.tagNotFound,
        });
      }
      const path = record.path.length
        ? record.path
        : existing
          ? tagAncestry(existing, existingById).map((tag) => tag.name)
          : [];
      if (path.length > maxLevel)
        invalid.push({
          rowNumber: record.rowNumber,
          name: tagPathLabel(path),
          message: messages.levelExceeded,
        });
      return { rowNumber: record.rowNumber, path, fields: record.fields };
    });
    const coalesced = coalesceTagTreeRecords(parsed.records, locale, messages);
    invalid.push(...toFailures(coalesced.errors));
    parsed.records = coalesced.records;
    if (invalid.length) return { kind: "fatal", failures: invalid };
  }
  const records = parsed.records.map((record) =>
    record.id === undefined ? { ...record, path: canonicalizePath(lookup, record.path) } : record,
  );

  // 只把缺失路径建成局部树再 merge，避免整表推 MuseDAM
  const pathRecords = records.filter((record) => record.id === undefined);
  const missingPathRecords = importMode === "overwrite"
    ? pathRecords
    : filterMissingPathRecords(pathRecords, (path) => resolvePath(lookup, path) !== null);
  const createTree = tagBatchRecordsToCreateTree(missingPathRecords);
  const createPaths = collectNewTagPaths(createTree, lookup);
  if (!dryRun && createTree.length > 0) {
    const created = await batchCreateTags(createTree, importMode === "overwrite" ? 1 : 2, {
      imported: true,
    });
    if (!created.success) {
      return { kind: "error", message: created.message || messages.rowImportFailed };
    }
    tags = await loadTeamTagRows(teamId);
    lookup = buildTagLookup(tags);
  }

  const idIndex = indexTagsById(tags);
  const parentIds = new Set(tags.map((tag) => tag.parentId));
  const nameOwnerIndex = buildNameOwnerIndex(tags);
  const renameTargets = new Map<number, string>();
  for (const record of records) {
    if (record.id !== undefined && record.path.length > 0 && idIndex.has(record.id)) {
      renameTargets.set(record.id, record.path[record.path.length - 1].trim());
    }
  }
  const failures = toFailures(parsed.errors);

  const prepared: PreparedUpdate[] = [];
  let noopSuccessCount = 0;
  const firstRowByTarget = new Map<string, number>();
  const claimTarget = (key: string, record: ParsedTagBatchRecord) => {
    const firstRow = firstRowByTarget.get(key);
    if (firstRow !== undefined) {
      failures.push({
        rowNumber: record.rowNumber,
        name: record.id !== undefined ? `ID ${record.id}` : tagPathLabel(record.path),
        message: messages.duplicateTarget(firstRow),
      });
      return false;
    }
    firstRowByTarget.set(key, record.rowNumber);
    return true;
  };

  for (const record of records) {
    const tag =
      record.id !== undefined
        ? (idIndex.get(record.id) ?? null)
        : (resolvePath(lookup, record.path)?.at(-1) ?? null);
    if (!tag) {
      if (dryRun && record.id === undefined) {
        claimTarget(`path:${record.path.join("\u0000").toLowerCase()}`, record);
        continue;
      }
      failures.push({
        rowNumber: record.rowNumber,
        name: record.id !== undefined ? `ID ${record.id}` : tagPathLabel(record.path),
        message: messages.tagNotFound,
      });
      continue;
    }

    if (!claimTarget(`tag:${tag.id}`, record)) continue;

    try {
      if (tagAncestry(tag, idIndex).length > maxLevel) throw new Error(messages.levelExceeded);
      if (
        record.id !== undefined &&
        record.path.length > 0 &&
        !idPathMatchesTag(tag, record.path, idIndex, renameTargets)
      ) {
        throw new Error(messages.pathMismatch);
      }
      let update = prepareRecordUpdate(tag, record, messages, nameOwnerIndex, !dryRun);
      if (!dryRun && record.fields.requiredGroup === true && !parentIds.has(tag.id)) {
        update ??= { record, tag, data: {} };
        update.data.extra = {
          ...((update.data.extra ?? tag.extra ?? {}) as AssetTagExtra),
          requiredGroup: false,
        };
        update.autoDisabledRequiredGroup = true;
      }
      if (!update) {
        noopSuccessCount += 1;
        continue;
      }
      update.importAncestorIds = tagAncestry(tag, idIndex)
        .map((ancestor) => ancestor.id)
        .filter((id) => id !== tag.id);
      prepared.push(update);
    } catch (error) {
      failures.push({
        rowNumber: record.rowNumber,
        name: record.id !== undefined ? `ID ${record.id}` : tagPathLabel(record.path) || tag.name,
        message: error instanceof Error ? error.message : messages.rowImportFailed,
      });
    }
  }

  // An invalid ancestor rename must not make a descendant's otherwise-invalid path look valid.
  let removedDependentRename = true;
  while (removedDependentRename) {
    removedDependentRename = false;
    const acceptedRenames = new Map(
      prepared.filter((item) => item.data.name).map((item) => [item.tag.id, item.data.name!]),
    );
    for (let index = prepared.length - 1; index >= 0; index -= 1) {
      const item = prepared[index];
      if (
        item.record.id !== undefined &&
        item.record.path.length > 0 &&
        !idPathMatchesTag(item.tag, item.record.path, idIndex, acceptedRenames)
      ) {
        failures.push({
          rowNumber: item.record.rowNumber,
          name: `ID ${item.tag.id}`,
          message: messages.pathMismatch,
        });
        prepared.splice(index, 1);
        removedDependentRename = true;
      }
    }
  }

  failures.sort((a, b) => a.rowNumber - b.rowNumber);
  const failedRowNumbers = new Set(failures.map((failure) => failure.rowNumber));
  return {
    kind: "ready",
    prepared,
    failures,
    noopSuccessCount,
    skippedCount: skippedRows.size,
    idIndex,
    createCount: createPaths.length,
    createPaths,
    previewTree: tagBatchRecordsToCreateTree(
      records
        .filter((record) => !failedRowNumbers.has(record.rowNumber))
        .map((record) => ({
          ...record,
          id: undefined,
          path: record.path.length
            ? record.path
            : tagAncestry(idIndex.get(record.id!)!, idIndex).map((tag) => tag.name),
        })),
    ),
  };
}

/** 建树结果中本地尚不存在的节点路径（含被隐式创建的中间层级） */
function collectNewTagPaths(
  nodes: TagBatchCreateNode[],
  lookup: TagLookup,
  parent: { id: number | null; isNew: boolean } = { id: null, isNew: false },
  ancestors: string[] = [],
  result: string[] = [],
) {
  for (const node of nodes) {
    const path = [...ancestors, node.name];
    const existing = parent.isNew ? undefined : resolveChild(lookup, parent.id, node.name);
    if (!existing) result.push(tagPathLabel(path));
    collectNewTagPaths(
      node.nameChildList ?? [],
      lookup,
      { id: existing?.id ?? null, isNew: !existing },
      path,
      result,
    );
  }
  return result;
}

function toFailures(errors: Array<{ rowNumber: number; message: string }>): ImportFailure[] {
  return errors.map((error) => ({
    rowNumber: error.rowNumber,
    name: null,
    message: error.message,
  }));
}

function fileResult(prefix: string, format: BatchFileFormat, rows: string[][]) {
  const { buffer, mimeType } = encodeBatchFile({ rows, format });
  return {
    success: true as const,
    data: {
      filename: getBatchFileName(prefix, format),
      mimeType,
      base64: buffer.toString("base64"),
    },
  };
}

function limitTagTreeDepth(
  nodes: TagBatchExportNode[],
  maxLevel: number,
  depth = 1,
): TagBatchExportNode[] {
  if (depth > maxLevel) return [];
  return nodes.map((node) => ({
    ...node,
    children: limitTagTreeDepth(node.children ?? [], maxLevel, depth + 1),
  }));
}

async function loadTagTree(teamId: number): Promise<TagBatchExportNode[]> {
  const tags = await prisma.assetTag.findMany({
    where: { teamId },
    select: {
      id: true,
      name: true,
      parentId: true,
      sort: true,
      taggingEnabled: true,
      extra: true,
    },
    orderBy: [{ sort: "desc" }, { name: "asc" }],
  });
  const byParent = new Map<number | null, typeof tags>();
  for (const tag of tags) {
    const siblings = byParent.get(tag.parentId) ?? [];
    siblings.push(tag);
    byParent.set(tag.parentId, siblings);
  }
  const toNode = (tag: (typeof tags)[number]): TagBatchExportNode => ({
    id: tag.id,
    name: tag.name,
    taggingEnabled: tag.taggingEnabled,
    extra: tag.extra,
    children: (byParent.get(tag.id) ?? []).map(toNode),
  });
  return (byParent.get(null) ?? []).map(toNode);
}

async function loadTeamTagRows(teamId: number): Promise<TagRow[]> {
  return prisma.assetTag.findMany({
    where: { teamId },
    select: { id: true, name: true, slug: true, parentId: true, extra: true, taggingEnabled: true },
  });
}

type TagLookup = {
  exact: Map<string, TagRow>;
  insensitive: Map<string, TagRow>;
};

function buildTagLookup(tags: TagRow[]): TagLookup {
  const exact = new Map<string, TagRow>();
  const insensitive = new Map<string, TagRow>();
  for (const tag of tags) {
    exact.set(tagKey(tag.parentId, tag.name), tag);
    const lowerKey = lowerTagKey(tag.parentId, tag.name);
    if (!insensitive.has(lowerKey)) insensitive.set(lowerKey, tag);
  }
  return { exact, insensitive };
}

function resolveChild(lookup: TagLookup, parentId: number | null, name: string) {
  return (
    lookup.exact.get(tagKey(parentId, name)) ?? lookup.insensitive.get(lowerTagKey(parentId, name))
  );
}

/** 返回从一级到末级的标签链；任一级不存在返回 null */
function resolvePath(lookup: TagLookup, path: string[]) {
  if (path.length === 0) return null;
  const chain: TagRow[] = [];
  let parentId: number | null = null;
  for (const name of path) {
    const tag = resolveChild(lookup, parentId, name);
    if (!tag) return null;
    chain.push(tag);
    parentId = tag.id;
  }
  return chain;
}

function canonicalizePath(lookup: TagLookup, path: string[]) {
  const next = [...path];
  let parentId: number | null = null;
  for (let index = 0; index < next.length; index += 1) {
    const tag = resolveChild(lookup, parentId, next[index]);
    if (!tag) break;
    next[index] = tag.name;
    parentId = tag.id;
  }
  return next;
}

function indexTagsById(tags: TagRow[]) {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

function buildNameOwnerIndex(tags: TagRow[]) {
  const index = new Map<string, number>();
  for (const tag of tags) {
    const key = lowerTagKey(tag.parentId, tag.name);
    if (!index.has(key)) index.set(key, tag.id);
  }
  return index;
}

/** 从一级到自身的标签链 */
function tagAncestry(tag: TagRow, idIndex: Map<number, TagRow>) {
  const chain: TagRow[] = [tag];
  let current = tag;
  while (current.parentId !== null && chain.length <= MAX_TAG_LEVEL) {
    const parent = idIndex.get(current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/**
 * 带 ID 的行：路径层数必须等于标签实际层级，上级名需与库中一致（或与本次导入中该上级的新名一致）。
 * 防止清空末级单元格后把标签改成上级的名字，或误以为能通过改上级列移动标签。
 */
function idPathMatchesTag(
  tag: TagRow,
  path: string[],
  idIndex: Map<number, TagRow>,
  renameTargets: Map<number, string>,
) {
  const chain = tagAncestry(tag, idIndex);
  if (chain.length !== path.length) return false;
  for (let index = 0; index < chain.length - 1; index += 1) {
    const expected = path[index].trim().toLowerCase();
    const ancestor = chain[index];
    const renamed = renameTargets.get(ancestor.id);
    if (
      ancestor.name.trim().toLowerCase() !== expected &&
      (renamed === undefined || renamed.toLowerCase() !== expected)
    ) {
      return false;
    }
  }
  return true;
}

/** 只含改名节点及其祖先链的树：祖先不带 verb（MuseDAM 不操作），改名节点为 update */
function buildRenameSyncTree(items: PreparedUpdate[], idIndex: Map<number, TagRow>) {
  const roots: TagNode[] = [];
  const nodes = new Map<number, TagNode>();
  for (const item of items) {
    let siblings = roots;
    for (const tag of tagAncestry(item.tag, idIndex)) {
      let node = nodes.get(tag.id);
      if (!node) {
        node = { id: tag.id, slug: tag.slug, name: tag.name, originalName: tag.name, children: [] };
        nodes.set(tag.id, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
    const target = nodes.get(item.tag.id);
    if (target && item.data.name) {
      target.name = item.data.name;
      target.verb = "update";
    }
  }
  return roots;
}

function tagKey(parentId: number | null, name: string) {
  return `${parentId ?? "root"}_${name.trim()}`;
}

function lowerTagKey(parentId: number | null, name: string) {
  return tagKey(parentId, name).toLowerCase();
}

function prepareRecordUpdate(
  tag: TagRow,
  record: ParsedTagBatchRecord,
  messages: TagBatchMessages,
  nameOwnerIndex: Map<string, number>,
  markImported = true,
): PreparedUpdate | null {
  const patch = record.fields;
  const nextName =
    record.id !== undefined && record.path.length > 0
      ? record.path[record.path.length - 1].trim()
      : undefined;
  const shouldRename = Boolean(nextName && nextName !== tag.name);

  const imported =
    !markImported || ((tag.extra ?? {}) as AssetTagExtra).configurationSource === "import";
  if (!hasFieldPatch(patch) && !shouldRename && imported) return null;

  if (shouldRename && nextName) {
    const ownerId = nameOwnerIndex.get(lowerTagKey(tag.parentId, nextName));
    if (ownerId !== undefined && ownerId !== tag.id) {
      throw new Error(messages.nameExists);
    }
  }

  const currentExtra = (tag.extra as AssetTagExtra) || {};
  const nextExtra: AssetTagExtra = {
    ...currentExtra,
    ...(markImported ? { configurationSource: "import" as const } : {}),
  };
  let extraChanged = !imported;
  if (patch.description !== undefined && patch.description !== (currentExtra.description ?? "")) {
    nextExtra.description = patch.description;
    extraChanged = true;
  }
  if (patch.keywords !== undefined && !sameKeywords(patch.keywords, currentExtra.keywords)) {
    nextExtra.keywords = patch.keywords;
    extraChanged = true;
  }
  if (
    patch.negativeKeywords !== undefined &&
    !sameKeywords(patch.negativeKeywords, currentExtra.negativeKeywords)
  ) {
    Object.assign(
      nextExtra,
      pruneRejectionCountsForRemovedKeywords(currentExtra, patch.negativeKeywords),
    );
    extraChanged = true;
  }
  if (
    patch.siblingsExclusive !== undefined &&
    patch.siblingsExclusive !== (currentExtra.siblingsExclusive ?? false)
  ) {
    nextExtra.siblingsExclusive = patch.siblingsExclusive;
    extraChanged = true;
  }
  if (
    patch.requiredGroup !== undefined &&
    patch.requiredGroup !== (currentExtra.requiredGroup ?? false)
  ) {
    nextExtra.requiredGroup = patch.requiredGroup;
    extraChanged = true;
  }

  // 预占改名后的同级名，避免同一批内两行改成同名
  if (shouldRename && nextName) {
    const oldKey = lowerTagKey(tag.parentId, tag.name);
    if (nameOwnerIndex.get(oldKey) === tag.id) nameOwnerIndex.delete(oldKey);
    nameOwnerIndex.set(lowerTagKey(tag.parentId, nextName), tag.id);
  }

  const taggingChanged =
    patch.taggingEnabled !== undefined && patch.taggingEnabled !== tag.taggingEnabled;
  if (!shouldRename && !taggingChanged && !extraChanged) return null;
  return {
    record,
    tag,
    data: {
      ...(shouldRename && nextName ? { name: nextName } : {}),
      ...(taggingChanged ? { taggingEnabled: patch.taggingEnabled } : {}),
      ...(extraChanged ? { extra: nextExtra } : {}),
    },
  };
}

function sameKeywords(next: string[], current?: string[]) {
  const previous = current ?? [];
  return next.length === previous.length && next.every((value, index) => value === previous[index]);
}

function applyPreparedUpdateLocally(item: PreparedUpdate) {
  if (item.data.name) item.tag.name = item.data.name;
  if (item.data.extra) item.tag.extra = item.data.extra as Prisma.JsonValue;
  if (item.data.taggingEnabled !== undefined) item.tag.taggingEnabled = item.data.taggingEnabled;
}

function hasFieldPatch(patch: TagBatchFieldPatch) {
  return (
    patch.description !== undefined ||
    patch.keywords !== undefined ||
    patch.negativeKeywords !== undefined ||
    patch.taggingEnabled !== undefined ||
    patch.siblingsExclusive !== undefined ||
    patch.requiredGroup !== undefined
  );
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
