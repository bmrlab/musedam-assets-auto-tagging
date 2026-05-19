"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import {
  BrandDetectionBox,
  classifyBrandImageCrops,
  detectBrandLogoBoxes,
} from "@/lib/brand/logo-classification";
import { fetchLogoDetectionLabelText } from "@/lib/brand/logo-detection-prompt";
import {
  markAssetLogoVectorsProcessing,
  processAssetLogoReferenceVectors,
} from "@/lib/brand/logo-processing";
import { deleteLogoVectorPointsByLogo, setLogoVectorPayloadByLogo } from "@/lib/brand/qdrant";
import { buildAssetLogoObjectKey, getCachedSignedOssObjectUrl, uploadOssObject } from "@/lib/oss";
import { ServerActionResult } from "@/lib/serverAction";
import { schedulePushFeatureToMuseDAM } from "@/musedam/push-feature-to-musedam";
import {
  AssetLogo,
  AssetLogoImage,
  AssetLogoTag,
  AssetLogoType,
  AssetTag,
} from "@/prisma/client/index";
import prisma from "@/prisma/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import { after } from "next/server";
import { z } from "zod";
import {
  BRAND_BATCH_ENABLED_VALUES,
  BrandBatchFileErrorMessages,
  BrandBatchFileFormat,
  buildBrandBatchExportRows,
  buildBrandBatchTemplateRows,
  getBrandBatchColumns,
  encodeCsv,
  encodeXlsx,
  parseBrandBatchRows,
  parseCsv,
  ParsedBrandBatchRow,
  parseXlsx,
  splitBrandBatchValues,
} from "./batchFile";
import {
  BrandClassificationResult,
  BrandClassificationUploadResult,
  BrandLibraryPageData,
  BrandLogoBatchFileResult,
  BrandLogoBatchImportFailure,
  BrandLogoBatchImportResult,
  BrandLogoImageItem,
  BrandLogoItem,
  BrandLogoTagItem,
  BrandLogoTypeItem,
  BrandTagTreeNode,
} from "./types";

async function getBrandLibraryTranslations() {
  return getTranslations("Tagging.BrandLibrary");
}

type BrandLibraryTranslationFn = Awaited<ReturnType<typeof getBrandLibraryTranslations>>;

function getBrandBatchFileErrors(t: BrandLibraryTranslationFn): BrandBatchFileErrorMessages {
  return {
    missingHeader: t("batchImportExport.fileErrors.missingHeader"),
    noDataRows: t("batchImportExport.fileErrors.noDataRows"),
    excelMissingWorksheet: t("batchImportExport.fileErrors.excelMissingWorksheet"),
    excelInvalidStructure: t("batchImportExport.fileErrors.excelInvalidStructure"),
    excelUnsupportedCompression: t("batchImportExport.fileErrors.excelUnsupportedCompression"),
  };
}

const createOrUpdateLogoSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "nameRequired").max(255, "nameTooLong"),
  logoTypeId: z.string().uuid(),
  tagIds: z.array(z.number().int().positive()).min(1, "tagsRequired").max(100),
  notes: z.string().max(5000).default(""),
  existingImageIds: z.array(z.string().uuid()).max(100).default([]),
  assetLibraryDownloadUrls: z.array(z.string().url()).max(100).default([]),
  assetLibraryUploadedImages: z
    .array(
      z.object({
        objectKey: z.string().min(1),
        mimeType: z.string().min(1),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(100)
    .default([]),
});

const logoTypeNameSchema = z.string().trim().min(1, "typeNameRequired").max(100, "typeNameTooLong");

type AssetTagWithParents = AssetTag & {
  parent: (AssetTag & { parent: AssetTag | null }) | null;
};

type AssetLogoRecord = AssetLogo & {
  images: AssetLogoImage[];
  tags: AssetLogoTag[];
};

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return JSON.parse(value) as T;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || file.name.toLowerCase().endsWith(".svg");
}

function getFileExtension(file: File) {
  const match = file.name.match(/\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (file.type === "image/png") return ".png";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/svg+xml") return ".svg";
  if (file.type === "image/gif") return ".gif";
  return "";
}

function buildTagPath(tag: AssetTagWithParents) {
  const path: string[] = [];
  let current: AssetTagWithParents | AssetTag | null = tag;

  while (current) {
    path.unshift(current.name);
    current =
      "parent" in current && current.parent
        ? (current.parent as AssetTagWithParents | AssetTag)
        : null;
  }

  return path;
}

function normalizeBrandLogoType(type: AssetLogoType): BrandLogoTypeItem {
  return {
    id: type.id,
    name: type.name,
    sort: type.sort,
  };
}

function normalizeBrandLogoImage(image: AssetLogoImage): BrandLogoImageItem {
  const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
    objectKey: image.objectKey,
  });

  return {
    id: image.id,
    objectKey: image.objectKey,
    signedUrl,
    signedUrlExpiresAt,
    mimeType: image.mimeType,
    size: image.size,
    sort: image.sort,
  };
}

function normalizeBrandLogoTag(tag: AssetLogoTag): BrandLogoTagItem {
  return {
    id: tag.id,
    assetTagId: tag.assetTagId,
    tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
  };
}

function normalizeBrandLogo(logo: AssetLogoRecord): BrandLogoItem {
  return {
    id: logo.id,
    slug: logo.slug,
    name: logo.name,
    logoTypeId: logo.logoTypeId,
    logoTypeName: logo.logoTypeName,
    status: logo.status,
    processingError: logo.processingError,
    processedAt: logo.processedAt,
    enabled: logo.enabled,
    notes: logo.notes,
    createdAt: logo.createdAt,
    updatedAt: logo.updatedAt,
    images: logo.images
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeBrandLogoImage),
    tags: logo.tags
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeBrandLogoTag),
  };
}

function normalizeBrandTagTreeNode(
  tag: AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] },
): BrandTagTreeNode {
  return {
    id: tag.id,
    name: tag.name,
    level: tag.level,
    parentId: tag.parentId,
    children: (tag.children ?? []).map((child) => normalizeBrandTagTreeNode(child)),
  };
}

async function fetchActiveLogoTypes(teamId: number) {
  return prisma.assetLogoType.findMany({
    where: {
      teamId,
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
}

function getDefaultLogoTypeNames(locale: string): string[] {
  const normalizedLocale = locale.toLowerCase().replace(/_/g, "-");

  const defaults: Record<string, string[]> = {
    "zh-cn": ["主Logo", "子品牌Logo", "产品Logo", "水印", "商标", "其他"],
    "zh-tw": ["主Logo", "子品牌Logo", "產品Logo", "水印", "商標", "其他"],
    "en-us": ["Main Logo", "Sub-brand Logo", "Product Logo", "Watermark", "Trademark", "Others"],
    "ja-jp": ["メインLogo", "サブブランドLogo", "製品Logo", "ウォーターマーク", "商標", "その他"],
    "ko-kr": ["메인 로고", "서브 브랜드 로고", "제품 로고", "워터마크", "상표", "기타"],
    "fr-fr": [
      "Logo principal",
      "Logo de sous-marque",
      "Logo produit",
      "Filigrane",
      "Marque",
      "Autres",
    ],
    "de-de": [
      "Haupt-Logo",
      "Sub-Brand-Logo",
      "Produkt-Logo",
      "Wasserzeichen",
      "Markenzeichen",
      "Sonstiges",
    ],
    "es-es": [
      "Logo principal",
      "Logo de submarca",
      "Logo de producto",
      "Marca de agua",
      "Marca comercial",
      "Otros",
    ],
    "it-it": [
      "Logo principale",
      "Logo secondario",
      "Logo del prodotto",
      "Filigrana",
      "Marchio",
      "Altri",
    ],
    "pt-br": [
      "Logo Principal",
      "Logo Submarca",
      "Logo do Produto",
      "Marca d'Água",
      "Marca Registrada",
      "Outros",
    ],
    "ru-ru": [
      "Основной логотип",
      "Логотип суббренда",
      "Логотип продукта",
      "Водяной знак",
      "Торговая марка",
      "Другие",
    ],
    "vi-vn": ["Logo chính", "Logo sub-brand", "Logo sản phẩm", "Hình mờ", "Nhãn hiệu", "Khác"],
    "th-th": [
      "โลโก้หลัก",
      "โลโก้ซับแบรนด์",
      "โลโก้ผลิตภัณฑ์",
      "ลายน้ำ",
      "เครื่องหมายการค้า",
      "อื่น ๆ",
    ],
    "id-id": [
      "Logo Utama",
      "Logo Sub-merek",
      "Logo Produk",
      "Watermark",
      "Merek Dagang",
      "Lainnya",
    ],
    "hi-in": ["मुख्य लोगो", "सब-ब्रांड लोगो", "उत्पाद लोगो", "वॉटरमार्क", "ट्रेडमार्क", "अन्य"],
    "tr-tr": ["Ana Logo", "Alt Marka Logo", "Ürün Logo", "Filigran", "Ticari Marka", "Diğerleri"],
    "pl-pl": [
      "Logo główne",
      "Logo podmarki",
      "Logo produktu",
      "Znak wodny",
      "Znak towarowy",
      "Inne",
    ],
  };

  return defaults[normalizedLocale] || defaults["en-us"]!;
}

async function ensureDefaultLogoTypes(teamId: number, locale: string) {
  const existing = await fetchActiveLogoTypes(teamId);
  if (existing.length > 0) {
    return existing;
  }

  const names = getDefaultLogoTypeNames(locale);
  await prisma.assetLogoType.createMany({
    data: names.map((name, index) => ({
      teamId,
      name,
      sort: index + 1,
    })),
  });

  return fetchActiveLogoTypes(teamId);
}

async function fetchBrandTags(teamId: number) {
  const tags = await prisma.assetTag.findMany({
    where: {
      teamId,
      parentId: null,
    },
    orderBy: [{ sort: "desc" }, { name: "asc" }],
    include: {
      children: {
        orderBy: [{ sort: "desc" }, { name: "asc" }],
        include: {
          children: {
            orderBy: [{ sort: "desc" }, { name: "asc" }],
          },
        },
      },
    },
  });

  return tags.map((tag) => normalizeBrandTagTreeNode(tag));
}

async function fetchBrandLogos(teamId: number) {
  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      images: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
      tags: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
    },
  });

  return logos.map((logo) => normalizeBrandLogo(logo));
}

async function resolveLogoType(teamId: number, logoTypeId: string) {
  const logoType = await prisma.assetLogoType.findFirst({
    where: {
      id: logoTypeId,
      teamId,
    },
  });

  if (!logoType) {
    throw new Error("所选标识类型不存在或已被删除");
  }

  return logoType;
}

async function resolveSelectedTags(teamId: number, tagIds: number[]) {
  const uniqueTagIds = Array.from(new Set(tagIds));

  if (uniqueTagIds.length === 0) {
    return [];
  }

  const tags = await prisma.assetTag.findMany({
    where: {
      teamId,
      id: {
        in: uniqueTagIds,
      },
    },
    include: {
      parent: {
        include: {
          parent: true,
        },
      },
    },
  });

  if (tags.length !== uniqueTagIds.length) {
    throw new Error("关联标签中存在无效项，请重新选择");
  }

  const tagMap = new Map(tags.map((tag) => [tag.id, tag as AssetTagWithParents]));

  return uniqueTagIds.map((tagId, index) => {
    const tag = tagMap.get(tagId);
    if (!tag) {
      throw new Error("关联标签中存在无效项，请重新选择");
    }

    return {
      assetTagId: tag.id,
      sort: index + 1,
      tagPath: buildTagPath(tag),
    };
  });
}

async function uploadNewLogoImages({ files, teamId }: { files: File[]; teamId: number }) {
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
  }> = [];

  for (const file of files) {
    if (!isImageFile(file)) {
      throw new Error(`文件 ${file.name} 不是支持的图片格式`);
    }

    const objectKey = buildAssetLogoObjectKey({
      teamId,
      extension: getFileExtension(file),
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadResult = await uploadOssObject({
      body: buffer,
      contentType: file.type || "application/octet-stream",
      objectKey,
    });

    uploads.push({
      objectKey: uploadResult.objectKey,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    });
  }

  return uploads;
}

function getImageExtensionFromUrlOrContentType({
  imageUrl,
  contentType,
}: {
  imageUrl: string;
  contentType: string;
}) {
  try {
    const pathname = new URL(imageUrl).pathname;
    const match = pathname.match(/\.[a-zA-Z0-9]+$/);
    if (match) {
      return match[0].toLowerCase();
    }
  } catch {
    // ignore invalid URL and fall back to content type
  }

  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/svg+xml")) return ".svg";
  if (contentType.includes("image/gif")) return ".gif";
  return "";
}

async function uploadAssetLibraryImages({
  downloadUrls,
  teamId,
}: {
  downloadUrls: string[];
  teamId: number;
}) {
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
  }> = [];

  for (const downloadUrl of downloadUrls) {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`从素材库下载图片失败（${response.status}）`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    // if (!contentType.startsWith("image/")) {
    //   throw new Error("素材库文件不是支持的图片格式");
    // }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = getImageExtensionFromUrlOrContentType({
      imageUrl: downloadUrl,
      contentType,
    });
    const objectKey = buildAssetLogoObjectKey({
      teamId,
      extension,
    });

    const uploadResult = await uploadOssObject({
      body: buffer,
      contentType,
      objectKey,
    });

    uploads.push({
      objectKey: uploadResult.objectKey,
      mimeType: contentType,
      size: buffer.byteLength,
    });
  }

  return uploads;
}

function getImageExtensionFromObjectKeyOrContentType({
  objectKey,
  contentType,
}: {
  objectKey: string;
  contentType: string;
}) {
  const match = objectKey.split("?")[0].match(/\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/svg+xml")) return ".svg";
  if (contentType.includes("image/gif")) return ".gif";
  return "";
}

async function cloneLogoImageFromObjectKey({
  objectKey,
  teamId,
  t,
}: {
  objectKey: string;
  teamId: number;
  t: BrandLibraryTranslationFn;
}) {
  const { signedUrl } = getCachedSignedOssObjectUrl({
    objectKey,
    expiresInSeconds: 60 * 60,
  });
  const response = await fetch(signedUrl);

  if (!response.ok) {
    throw new Error(t("batchImportExport.importErrors.ossKeyUnreadable", { objectKey }));
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = getImageExtensionFromObjectKeyOrContentType({
    objectKey,
    contentType,
  });
  const newObjectKey = buildAssetLogoObjectKey({
    teamId,
    extension,
  });

  const uploadResult = await uploadOssObject({
    body: buffer,
    contentType,
    objectKey: newObjectKey,
  });

  return {
    objectKey: uploadResult.objectKey,
    mimeType: contentType,
    size: buffer.byteLength,
  };
}

function getBatchFileName(prefix: string, format: BrandBatchFileFormat) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  return `${prefix}-${timestamp}.${format}`;
}

function encodeBrandBatchFile({
  rows,
  format,
}: {
  rows: string[][];
  format: BrandBatchFileFormat;
}) {
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

function parseBrandBatchFile({
  file,
  buffer,
  t,
  fileErrors,
}: {
  file: File;
  buffer: Buffer;
  t: BrandLibraryTranslationFn;
  fileErrors: BrandBatchFileErrorMessages;
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

  throw new Error(t("batchImportExport.unsupportedFileType"));
}

function normalizeTagPathKey(value: string) {
  return value
    .split(">")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(">");
}

async function buildTagPathLookup(teamId: number) {
  const tags = await prisma.assetTag.findMany({
    where: {
      teamId,
    },
    include: {
      parent: {
        include: {
          parent: true,
        },
      },
    },
  });
  const tagLookup = new Map<
    string,
    {
      assetTagId: number;
      tagPath: string[];
    }
  >();

  for (const tag of tags) {
    const tagPath = buildTagPath(tag as AssetTagWithParents);
    tagLookup.set(normalizeTagPathKey(tagPath.join(" > ")), {
      assetTagId: tag.id,
      tagPath,
    });
  }

  return tagLookup;
}

function resolveImportedTags({
  value,
  tagLookup,
  t,
}: {
  value: string;
  tagLookup: Map<string, { assetTagId: number; tagPath: string[] }>;
  t: BrandLibraryTranslationFn;
}) {
  const tagPathValues = splitBrandBatchValues(value);
  if (tagPathValues.length === 0) {
    throw new Error(t("batchImportExport.importErrors.tagsRequired"));
  }

  if (tagPathValues.length > 100) {
    throw new Error(t("batchImportExport.importErrors.tagsTooMany"));
  }

  const missingTagPaths: string[] = [];
  const selectedTags: Array<{
    assetTagId: number;
    sort: number;
    tagPath: string[];
  }> = [];
  const selectedTagIds = new Set<number>();

  for (const tagPathValue of tagPathValues) {
    const tag = tagLookup.get(normalizeTagPathKey(tagPathValue));
    if (!tag) {
      missingTagPaths.push(tagPathValue);
      continue;
    }

    if (selectedTagIds.has(tag.assetTagId)) {
      continue;
    }

    selectedTagIds.add(tag.assetTagId);
    selectedTags.push({
      assetTagId: tag.assetTagId,
      sort: selectedTags.length + 1,
      tagPath: tag.tagPath,
    });
  }

  if (missingTagPaths.length > 0) {
    throw new Error(
      t("batchImportExport.importErrors.tagsNotFound", {
        tags: missingTagPaths.join(t("batchImportExport.listSeparator")),
      }),
    );
  }

  return selectedTags;
}

function parseImportedEnabled(value: string, t: BrandLibraryTranslationFn) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (["true", "1", "yes", "y", "enabled"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "disabled"].includes(normalized)) {
    return false;
  }

  throw new Error(
    t("batchImportExport.importErrors.enabledInvalid", {
      enabled: BRAND_BATCH_ENABLED_VALUES.enabled,
      disabled: BRAND_BATCH_ENABLED_VALUES.disabled,
    }),
  );
}

function getUniqueImportedLogoName(
  baseName: string,
  existingNames: Set<string>,
  t: BrandLibraryTranslationFn,
) {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  for (let index = 1; index < 10000; index += 1) {
    const suffix = `(${index})`;
    const candidate = `${baseName.slice(0, 255 - suffix.length)}${suffix}`;

    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(t("batchImportExport.importErrors.uniqueNameFailed"));
}

async function ensureImportedLogoType({
  teamId,
  name,
  logoTypeCache,
}: {
  teamId: number;
  name: string;
  logoTypeCache: Map<string, AssetLogoType>;
}) {
  const cacheKey = name.toLowerCase();
  const cached = logoTypeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existingType = await prisma.assetLogoType.findFirst({
    where: {
      teamId,
      name,
    },
  });

  if (existingType) {
    logoTypeCache.set(cacheKey, existingType);
    return existingType;
  }

  const lastType = await prisma.assetLogoType.findFirst({
    where: {
      teamId,
    },
    orderBy: [{ sort: "desc" }, { id: "desc" }],
  });
  const logoType = await prisma.assetLogoType.create({
    data: {
      teamId,
      name,
      sort: (lastType?.sort ?? 0) + 1,
    },
  });

  logoTypeCache.set(cacheKey, logoType);
  return logoType;
}

async function importBrandBatchRow({
  team,
  row,
  tagLookup,
  logoTypeCache,
  existingNames,
  t,
}: {
  team: { id: number; slug: string };
  row: ParsedBrandBatchRow;
  tagLookup: Map<string, { assetTagId: number; tagPath: string[] }>;
  logoTypeCache: Map<string, AssetLogoType>;
  existingNames: Set<string>;
  t: BrandLibraryTranslationFn;
}) {
  const baseName = row.name.trim();
  const logoTypeName = row.logoTypeName.trim();
  const notes = row.notes.trim();
  const imageObjectKeys = splitBrandBatchValues(row.imageObjectKeys);

  if (!baseName) {
    throw new Error(t("batchImportExport.importErrors.nameRequired"));
  }

  if (baseName.length > 255) {
    throw new Error(t("batchImportExport.importErrors.nameTooLong"));
  }

  if (!logoTypeName) {
    throw new Error(t("batchImportExport.importErrors.typeRequired"));
  }

  if (logoTypeName.length > 100) {
    throw new Error(t("batchImportExport.importErrors.typeTooLong"));
  }

  if (notes.length > 5000) {
    throw new Error(t("batchImportExport.importErrors.notesTooLong"));
  }

  if (imageObjectKeys.length === 0) {
    throw new Error(t("batchImportExport.importErrors.imageKeysRequired"));
  }

  if (imageObjectKeys.length > 100) {
    throw new Error(t("batchImportExport.importErrors.imagesTooMany"));
  }

  const selectedTags = resolveImportedTags({
    value: row.tagPaths,
    tagLookup,
    t,
  });
  const enabled = parseImportedEnabled(row.enabled, t);
  const uploadedImages = [];

  for (const objectKey of imageObjectKeys) {
    uploadedImages.push(
      await cloneLogoImageFromObjectKey({
        objectKey,
        teamId: team.id,
        t,
      }),
    );
  }

  const logoType = await ensureImportedLogoType({
    teamId: team.id,
    name: logoTypeName,
    logoTypeCache,
  });
  const logoName = getUniqueImportedLogoName(baseName, existingNames, t);

  const createdLogo = await prisma.assetLogo.create({
    data: {
      teamId: team.id,
      name: logoName,
      logoTypeId: logoType.id,
      logoTypeName: logoType.name,
      notes,
      status: "processing",
      processingError: null,
      enabled,
      images: {
        create: uploadedImages.map((image, index) => ({
          ...image,
          sort: index + 1,
        })),
      },
      tags: {
        create: selectedTags.map((tag) => ({
          assetTagId: tag.assetTagId,
          tagPath: tag.tagPath,
          sort: tag.sort,
        })),
      },
    },
  });

  existingNames.add(logoName);

  const logo = await loadBrandLogo(team.id, createdLogo.id);
  scheduleAssetLogoProcessing(team.id, createdLogo.id);
  schedulePushFeatureToMuseDAM({
    team,
    featureType: "brand",
    identifierId: logo.id,
    identifierName: logo.name,
    identifierTypeId: logoType.id,
    identifierTypeName: logoType.name,
    firstImageObjectKey: logo.images[0]?.objectKey,
    internalAssetTagIds: selectedTags.map((tag) => tag.assetTagId),
  });

  return normalizeBrandLogo(logo);
}

type UploadedAssetLibraryImage = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

function extractSubmittedImages(formData: FormData) {
  return formData
    .getAll("images")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0);
}

function parseCreateOrUpdateInput(formData: FormData) {
  return createOrUpdateLogoSchema.parse({
    id: (() => {
      const idValue = formData.get("id");
      if (typeof idValue !== "string" || !idValue.trim()) {
        return undefined;
      }
      return idValue;
    })(),
    name: formData.get("name"),
    logoTypeId: formData.get("logoTypeId"),
    tagIds: parseJsonField<number[]>(formData.get("tagIds"), []),
    notes: typeof formData.get("notes") === "string" ? formData.get("notes") : "",
    existingImageIds: parseJsonField<string[]>(formData.get("existingImageIds"), []),
    assetLibraryDownloadUrls: parseJsonField<string[]>(
      formData.get("assetLibraryDownloadUrls"),
      [],
    ),
    assetLibraryUploadedImages: parseJsonField<
      Array<{ objectKey: string; mimeType: string; size: number }>
    >(formData.get("assetLibraryUploadedImages"), []),
  });
}

export async function prepareAssetLibraryLogoImagesAction(
  assets: Array<{ name: string; downloadUrl: string }>,
): Promise<ServerActionResult<{ images: UploadedAssetLibraryImage[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const normalizedAssets = z
        .array(
          z.object({
            name: z.string().trim().min(1).max(255),
            downloadUrl: z.string().url(),
          }),
        )
        .min(1, "请至少选择 1 个素材")
        .max(100, "单次最多选择 100 个素材")
        .parse(assets);

      const uploadedImages = await Promise.all(
        normalizedAssets.map(async (asset) => {
          const [uploaded] = await uploadAssetLibraryImages({
            downloadUrls: [asset.downloadUrl],
            teamId,
          });
          const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
            objectKey: uploaded.objectKey,
          });

          return {
            name: asset.name,
            objectKey: uploaded.objectKey,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
            signedUrl,
            signedUrlExpiresAt,
          };
        }),
      );

      return {
        success: true,
        data: {
          images: uploadedImages,
        },
      };
    } catch (error) {
      console.error("Failed to prepare asset library logo images:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "处理素材库图片失败",
      };
    }
  });
}

async function loadBrandLogo(teamId: number, logoId: string) {
  const logo = await prisma.assetLogo.findFirst({
    where: {
      id: logoId,
      teamId,
    },
    include: {
      images: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
      tags: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!logo) {
    throw new Error("品牌标识不存在或已被删除");
  }

  return logo;
}

async function loadBrandLogosByIds(teamId: number, logoIds: string[]) {
  if (logoIds.length === 0) {
    return [];
  }

  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
      id: {
        in: logoIds,
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      images: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
      tags: {
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      },
    },
  });

  return logos.map((logo) => normalizeBrandLogo(logo));
}

function scheduleAssetLogoProcessing(teamId: number, logoId: string) {
  after(async () => {
    try {
      await processAssetLogoReferenceVectors({
        teamId,
        logoId,
      });
    } catch (error) {
      console.error("Failed to process asset logo vectors:", error);
    }
  });
}

const classifyCropSchema = z.object({
  image: z.string().min(1, "缺少裁剪图片数据"),
  box: z.object({
    xMin: z.number().finite(),
    yMin: z.number().finite(),
    xMax: z.number().finite(),
    yMax: z.number().finite(),
    score: z.number().finite(),
    label: z.string(),
  }),
});

export async function refreshAssetLogoImageSignedUrlAction(imageId: string): Promise<
  ServerActionResult<{
    imageId: string;
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const image = await prisma.assetLogoImage.findFirst({
        where: {
          id: imageId,
          assetLogo: {
            teamId,
          },
        },
        select: {
          id: true,
          objectKey: true,
        },
      });

      if (!image) {
        return {
          success: false,
          message: "图片不存在或已被删除",
        };
      }

      const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
        objectKey: image.objectKey,
      });

      return {
        success: true,
        data: {
          imageId: image.id,
          signedUrl,
          signedUrlExpiresAt,
        },
      };
    } catch (error) {
      console.error("Failed to refresh asset logo image signed url:", error);
      return {
        success: false,
        message: "刷新图片链接失败",
      };
    }
  });
}

export async function fetchBrandLibraryPageData(): Promise<
  ServerActionResult<BrandLibraryPageData>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const locale = await getLocale();
      const [logos, logoTypes, tags] = await Promise.all([
        fetchBrandLogos(teamId),
        ensureDefaultLogoTypes(teamId, locale),
        fetchBrandTags(teamId),
      ]);

      return {
        success: true,
        data: {
          logos,
          logoTypes: logoTypes.map(normalizeBrandLogoType),
          tags,
        },
      };
    } catch (error) {
      console.error("Failed to fetch brand library data:", error);
      return {
        success: false,
        message: "加载品牌标识数据失败",
      };
    }
  });
}

export async function exportBrandLogosAction(
  format: BrandBatchFileFormat,
): Promise<ServerActionResult<BrandLogoBatchFileResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getBrandLibraryTranslations();

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const logos = await fetchBrandLogos(teamId);
      const rows = buildBrandBatchExportRows({ logos });
      const { buffer, mimeType } = encodeBrandBatchFile({
        rows,
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: getBatchFileName("brand-library", parsedFormat),
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to export brand logos:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("batchImportExport.exportFailed"),
      };
    }
  });
}

export async function downloadBrandImportTemplateAction(
  format: BrandBatchFileFormat = "xlsx",
): Promise<ServerActionResult<BrandLogoBatchFileResult>> {
  return withAuth(async () => {
    const t = await getBrandLibraryTranslations();

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const { buffer, mimeType } = encodeBrandBatchFile({
        rows: buildBrandBatchTemplateRows(),
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: `brand-import-template.${parsedFormat}`,
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to build brand import template:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : t("batchImportExport.templateDownloadFailed"),
      };
    }
  });
}

export async function importBrandLogosAction(
  formData: FormData,
): Promise<ServerActionResult<BrandLogoBatchImportResult>> {
  return withAuth(async ({ team }) => {
    const t = await getBrandLibraryTranslations();
    const fileErrors = getBrandBatchFileErrors(t);
    const columns = getBrandBatchColumns();

    try {
      const file = formData.get("file");

      if (!(file instanceof File) || file.size <= 0) {
        return {
          success: false,
          message: t("batchImportExport.selectImportFile"),
        };
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const tableRows = parseBrandBatchFile({
        file,
        buffer,
        t,
        fileErrors,
      });
      const parsedRows = parseBrandBatchRows({
        rows: tableRows,
        columns,
        fileErrors,
        listSeparator: t("batchImportExport.listSeparator"),
        formatMissingRequiredColumns: (columnNames) =>
          t("batchImportExport.fileErrors.missingRequiredColumns", { columns: columnNames }),
      });
      const logoTypes = await fetchActiveLogoTypes(team.id);

      if (parsedRows.errors.length > 0) {
        return {
          success: true,
          data: {
            createdLogos: [],
            logoTypes: logoTypes.map(normalizeBrandLogoType),
            successCount: 0,
            failedCount: parsedRows.errors.length,
            skippedCount: 0,
            failures: parsedRows.errors.map((error) => ({
              rowNumber: error.rowNumber,
              name: null,
              message: error.message,
            })),
          },
        };
      }

      const [tagLookup, existingLogos, activeLogoTypes] = await Promise.all([
        buildTagPathLookup(team.id),
        prisma.assetLogo.findMany({
          where: {
            teamId: team.id,
          },
          select: {
            name: true,
          },
        }),
        fetchActiveLogoTypes(team.id),
      ]);
      const existingNames = new Set(existingLogos.map((logo) => logo.name));
      const logoTypeCache = new Map(
        activeLogoTypes.map((logoType) => [logoType.name.toLowerCase(), logoType] as const),
      );
      const createdLogos: BrandLogoItem[] = [];
      const failures: BrandLogoBatchImportFailure[] = [];

      for (const row of parsedRows.records) {
        try {
          const logo = await importBrandBatchRow({
            team,
            row,
            tagLookup,
            logoTypeCache,
            existingNames,
            t,
          });
          createdLogos.push(logo);
        } catch (error) {
          failures.push({
            rowNumber: row.rowNumber,
            name: row.name.trim() || null,
            message:
              error instanceof Error ? error.message : t("batchImportExport.rowImportFailed"),
          });
        }
      }

      const nextLogoTypes = await fetchActiveLogoTypes(team.id);

      return {
        success: true,
        data: {
          createdLogos,
          logoTypes: nextLogoTypes.map(normalizeBrandLogoType),
          successCount: createdLogos.length,
          failedCount: failures.length,
          skippedCount: 0,
          failures,
        },
      };
    } catch (error) {
      console.error("Failed to import brand logos:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("batchImportExport.importFailed"),
      };
    }
  });
}

export async function createAssetLogoAction(
  formData: FormData,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team }) => {
    const t = await getBrandLibraryTranslations();
    try {
      const input = parseCreateOrUpdateInput(formData);
      const files = extractSubmittedImages(formData);
      const assetLibraryDownloadUrls = Array.from(new Set(input.assetLibraryDownloadUrls));
      const assetLibraryUploadedImages = input.assetLibraryUploadedImages;

      if (
        files.length + assetLibraryDownloadUrls.length + assetLibraryUploadedImages.length ===
        0
      ) {
        return {
          success: false,
          message: t("validation.imagesRequired"),
        };
      }

      const [logoType, selectedTags] = await Promise.all([
        resolveLogoType(team.id, input.logoTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uploadedImages = await uploadNewLogoImages({
        files,
        teamId: team.id,
      });
      const uploadedAssetLibraryImages = await uploadAssetLibraryImages({
        downloadUrls: assetLibraryDownloadUrls,
        teamId: team.id,
      });
      const allUploadedImages = [
        ...uploadedImages,
        ...assetLibraryUploadedImages,
        ...uploadedAssetLibraryImages,
      ];

      const createdLogo = await prisma.assetLogo.create({
        data: {
          teamId: team.id,
          name: input.name,
          logoTypeId: logoType.id,
          logoTypeName: logoType.name,
          notes: input.notes,
          status: "processing",
          processingError: null,
          enabled: true,
          images: {
            create: allUploadedImages.map((image, index) => ({
              ...image,
              sort: index + 1,
            })),
          },
          ...(selectedTags.length > 0
            ? {
                tags: {
                  create: selectedTags.map((tag) => ({
                    assetTagId: tag.assetTagId,
                    tagPath: tag.tagPath,
                    sort: tag.sort,
                  })),
                },
              }
            : {}),
        },
      });

      const logo = await loadBrandLogo(team.id, createdLogo.id);
      scheduleAssetLogoProcessing(team.id, createdLogo.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "brand",
        identifierId: logo.id,
        identifierName: logo.name,
        identifierTypeId: logoType.id,
        identifierTypeName: logoType.name,
        firstImageObjectKey: logo.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          logo: normalizeBrandLogo(logo),
        },
      };
    } catch (error) {
      console.error("Failed to create asset logo:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("createFailed"),
      };
    }
  });
}

export async function updateAssetLogoAction(
  formData: FormData,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team }) => {
    const t = await getBrandLibraryTranslations();
    try {
      const input = parseCreateOrUpdateInput(formData);
      if (!input.id) {
        return {
          success: false,
          message: t("validation.missingId"),
        };
      }

      const logo = await prisma.assetLogo.findFirst({
        where: {
          id: input.id,
          teamId: team.id,
        },
        include: {
          images: {
            orderBy: [{ sort: "asc" }, { id: "asc" }],
          },
        },
      });

      if (!logo) {
        return {
          success: false,
          message: t("processingErrors.logoNotFound"),
        };
      }

      const files = extractSubmittedImages(formData);
      const assetLibraryDownloadUrls = Array.from(new Set(input.assetLibraryDownloadUrls));
      const assetLibraryUploadedImages = input.assetLibraryUploadedImages;
      const [logoType, selectedTags] = await Promise.all([
        resolveLogoType(team.id, input.logoTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uniqueExistingImageIds = Array.from(new Set(input.existingImageIds));
      const retainedImages = logo.images.filter((image) =>
        uniqueExistingImageIds.includes(image.id),
      );

      if (retainedImages.length !== uniqueExistingImageIds.length) {
        return {
          success: false,
          message: t("validation.imagesExpired"),
        };
      }

      if (
        retainedImages.length +
          files.length +
          assetLibraryDownloadUrls.length +
          assetLibraryUploadedImages.length ===
        0
      ) {
        return {
          success: false,
          message: t("validation.keepAtLeastOneImage"),
        };
      }

      const uploadedImages = await uploadNewLogoImages({
        files,
        teamId: team.id,
      });
      const uploadedAssetLibraryImages = await uploadAssetLibraryImages({
        downloadUrls: assetLibraryDownloadUrls,
        teamId: team.id,
      });
      const allUploadedImages = [
        ...uploadedImages,
        ...assetLibraryUploadedImages,
        ...uploadedAssetLibraryImages,
      ];

      await prisma.$transaction(async (tx) => {
        await tx.assetLogo.update({
          where: {
            id: logo.id,
          },
          data: {
            name: input.name,
            logoTypeId: logoType.id,
            logoTypeName: logoType.name,
            notes: input.notes,
            status: "processing",
            processingError: null,
            processedAt: null,
          },
        });

        await tx.assetLogoImage.deleteMany({
          where: {
            assetLogoId: logo.id,
            id: {
              notIn: retainedImages.map((image) => image.id),
            },
          },
        });

        await tx.assetLogoTag.deleteMany({
          where: {
            assetLogoId: logo.id,
          },
        });

        const finalImages = [...retainedImages, ...allUploadedImages];

        for (let index = 0; index < retainedImages.length; index += 1) {
          await tx.assetLogoImage.update({
            where: {
              id: retainedImages[index].id,
            },
            data: {
              sort: index + 1,
              qdrantPointId: null,
              embeddingModel: null,
              embeddedAt: null,
            },
          });
        }

        if (allUploadedImages.length > 0) {
          await tx.assetLogoImage.createMany({
            data: allUploadedImages.map((image, index) => ({
              assetLogoId: logo.id,
              ...image,
              sort: retainedImages.length + index + 1,
            })),
          });
        }

        if (selectedTags.length > 0) {
          await tx.assetLogoTag.createMany({
            data: selectedTags.map((tag) => ({
              assetLogoId: logo.id,
              assetTagId: tag.assetTagId,
              sort: tag.sort,
              tagPath: tag.tagPath,
            })),
          });
        }

        if (finalImages.length === 0) {
          throw new Error("请至少保留 1 张标识图片");
        }
      });

      await setLogoVectorPayloadByLogo({
        teamId: team.id,
        assetLogoId: logo.id,
        payload: {
          enabled: logo.enabled,
          status: "processing",
        },
      }).catch((error) => {
        console.warn("Failed to mark logo vectors as processing:", error);
      });

      const updatedLogo = await loadBrandLogo(team.id, logo.id);
      scheduleAssetLogoProcessing(team.id, logo.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "brand",
        identifierId: updatedLogo.id,
        identifierName: updatedLogo.name,
        identifierTypeId: logoType.id,
        identifierTypeName: logoType.name,
        firstImageObjectKey: updatedLogo.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          logo: normalizeBrandLogo(updatedLogo),
        },
      };
    } catch (error) {
      console.error("Failed to update asset logo:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("updateFailed"),
      };
    }
  });
}

export async function setAssetLogoEnabledAction(
  logoId: string,
  enabled: boolean,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getBrandLibraryTranslations();
    try {
      const logo = await prisma.assetLogo.findFirst({
        where: {
          id: logoId,
          teamId,
        },
      });

      if (!logo) {
        return {
          success: false,
          message: t("processingErrors.logoNotFound"),
        };
      }

      await prisma.assetLogo.update({
        where: {
          id: logoId,
        },
        data: {
          enabled,
        },
      });

      await setLogoVectorPayloadByLogo({
        teamId,
        assetLogoId: logoId,
        payload: {
          enabled,
        },
      }).catch((error) => {
        console.warn("Failed to sync logo enabled payload to Qdrant:", error);
      });

      const updatedLogo = await loadBrandLogo(teamId, logoId);

      return {
        success: true,
        data: {
          logo: normalizeBrandLogo(updatedLogo),
        },
      };
    } catch (error) {
      console.error("Failed to toggle asset logo enabled:", error);
      return {
        success: false,
        message: t("toggleEnabledFailed"),
      };
    }
  });
}

export async function deleteAssetLogoAction(
  logoId: string,
): Promise<ServerActionResult<{ logoId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getBrandLibraryTranslations();
    try {
      const logo = await prisma.assetLogo.findFirst({
        where: {
          id: logoId,
          teamId,
        },
      });

      if (!logo) {
        return {
          success: false,
          message: t("processingErrors.logoNotFound"),
        };
      }

      await prisma.assetLogo.delete({
        where: {
          id: logoId,
        },
      });

      await deleteLogoVectorPointsByLogo({
        teamId,
        assetLogoId: logoId,
      }).catch(() => undefined);

      return {
        success: true,
        data: {
          logoId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset logo:", error);
      return {
        success: false,
        message: t("deleteFailed"),
      };
    }
  });
}

export async function retryAssetLogoProcessingAction(
  logoId: string,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.BrandLibrary");
      const logo = await prisma.assetLogo.findFirst({
        where: {
          id: logoId,
          teamId,
        },
      });

      if (!logo) {
        return {
          success: false,
          message: "品牌标识不存在或已被删除",
        };
      }

      if (logo.status !== "failed") {
        return {
          success: false,
          message: t("retryOnlyFailed"),
        };
      }

      await markAssetLogoVectorsProcessing({
        teamId,
        logoId,
        enabled: logo.enabled,
      });

      const updatedLogo = await loadBrandLogo(teamId, logoId);
      scheduleAssetLogoProcessing(teamId, logoId);

      return {
        success: true,
        data: {
          logo: normalizeBrandLogo(updatedLogo),
        },
      };
    } catch (error) {
      console.error("Failed to retry asset logo processing:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : (await getTranslations("Tagging.BrandLibrary"))("retryFailed"),
      };
    }
  });
}

export async function pollBrandLogosAction(
  logoIds: string[],
): Promise<ServerActionResult<{ logos: BrandLogoItem[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const uniqueIds = Array.from(new Set(logoIds)).filter(
        (id) => typeof id === "string" && id.length > 0,
      );
      const logos = await loadBrandLogosByIds(teamId, uniqueIds);

      return {
        success: true,
        data: {
          logos,
        },
      };
    } catch (error) {
      console.error("Failed to poll brand logos:", error);
      return {
        success: false,
        message: "刷新品牌标识状态失败",
      };
    }
  });
}

export async function prepareBrandClassificationAction(
  formData: FormData,
): Promise<ServerActionResult<BrandClassificationUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const image = formData.get("image");
      if (!(image instanceof File) || image.size <= 0) {
        return {
          success: false,
          message: "请上传待分类的商品图片",
        };
      }

      if (!isImageFile(image)) {
        return {
          success: false,
          message: "仅支持图片文件",
        };
      }

      const objectKey = buildAssetLogoObjectKey({
        teamId,
        extension: getFileExtension(image),
      });
      const buffer = Buffer.from(await image.arrayBuffer());
      await uploadOssObject({
        body: buffer,
        contentType: image.type || "application/octet-stream",
        objectKey,
      });

      const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
        objectKey,
        expiresInSeconds: 60 * 60,
      });
      const detectionLabelText = await fetchLogoDetectionLabelText(teamId);
      const detection = await detectBrandLogoBoxes({
        teamId,
        imageUrl: signedUrl,
        detectionLabelText,
      });

      return {
        success: true,
        data: {
          objectKey,
          signedUrl,
          signedUrlExpiresAt,
          detections: detection.detections,
          found: detection.found,
        },
      };
    } catch (error) {
      console.error("Failed to prepare brand classification:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "商品图片预处理失败",
      };
    }
  });
}

export async function classifyBrandImageAction(input: {
  crops: Array<{
    image: string;
    box: BrandDetectionBox;
  }>;
}): Promise<ServerActionResult<{ result: BrandClassificationResult }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const crops = z.array(classifyCropSchema).min(1, "请先选择至少一个候选框").parse(input.crops);

      const result = await classifyBrandImageCrops({
        teamId,
        crops,
      });

      return {
        success: true,
        data: {
          result,
        },
      };
    } catch (error) {
      console.error("Failed to classify brand image:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Logo 分类失败",
      };
    }
  });
}

export async function createAssetLogoTypeAction(
  name: string,
): Promise<ServerActionResult<{ logoType: BrandLogoTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const parsedName = logoTypeNameSchema.parse(name);

      const existingType = await prisma.assetLogoType.findFirst({
        where: {
          teamId,
          name: parsedName,
        },
      });

      if (existingType) {
        return {
          success: false,
          message: "该标识类型已存在",
        };
      }

      const lastType = await prisma.assetLogoType.findFirst({
        where: {
          teamId,
        },
        orderBy: [{ sort: "desc" }, { id: "desc" }],
      });

      const logoType = await prisma.assetLogoType.create({
        data: {
          teamId,
          name: parsedName,
          sort: (lastType?.sort ?? 0) + 1,
        },
      });

      return {
        success: true,
        data: {
          logoType: normalizeBrandLogoType(logoType),
        },
      };
    } catch (error) {
      console.error("Failed to create asset logo type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "创建标识类型失败",
      };
    }
  });
}

export async function updateAssetLogoTypeAction(
  logoTypeId: string,
  name: string,
): Promise<ServerActionResult<{ logoType: BrandLogoTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const parsedName = logoTypeNameSchema.parse(name);

      const logoType = await prisma.assetLogoType.findFirst({
        where: {
          id: logoTypeId,
          teamId,
        },
      });

      if (!logoType) {
        return {
          success: false,
          message: "标识类型不存在或已被删除",
        };
      }

      const duplicatedType = await prisma.assetLogoType.findFirst({
        where: {
          teamId,
          name: parsedName,
          id: {
            not: logoTypeId,
          },
        },
      });

      if (duplicatedType) {
        return {
          success: false,
          message: "该标识类型已存在",
        };
      }

      const updatedType = await prisma.$transaction(async (tx) => {
        const nextType = await tx.assetLogoType.update({
          where: {
            id: logoTypeId,
          },
          data: {
            name: parsedName,
          },
        });

        await tx.assetLogo.updateMany({
          where: {
            teamId,
            logoTypeId,
          },
          data: {
            logoTypeName: parsedName,
          },
        });

        return nextType;
      });

      return {
        success: true,
        data: {
          logoType: normalizeBrandLogoType(updatedType),
        },
      };
    } catch (error) {
      console.error("Failed to update asset logo type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "更新标识类型失败",
      };
    }
  });
}

export async function softDeleteAssetLogoTypeAction(
  logoTypeId: string,
): Promise<ServerActionResult<{ logoTypeId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const logoType = await prisma.assetLogoType.findFirst({
        where: {
          id: logoTypeId,
          teamId,
        },
      });

      if (!logoType) {
        return {
          success: false,
          message: "标识类型不存在或已被删除",
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.assetLogoType.delete({
          where: {
            id: logoTypeId,
          },
        });

        const remainingTypes = await tx.assetLogoType.findMany({
          where: {
            teamId,
          },
          select: {
            id: true,
          },
          orderBy: [{ sort: "asc" }, { id: "asc" }],
        });

        await Promise.all(
          remainingTypes.map((type, index) =>
            tx.assetLogoType.update({
              where: {
                id: type.id,
              },
              data: {
                sort: index + 1,
              },
            }),
          ),
        );
      });

      return {
        success: true,
        data: {
          logoTypeId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset logo type:", error);
      return {
        success: false,
        message: "删除标识类型失败",
      };
    }
  });
}

export async function reorderAssetLogoTypesAction(
  orderedIds: string[],
): Promise<ServerActionResult<{ orderedIds: string[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const uniqueOrderedIds = Array.from(new Set(orderedIds));

      const activeTypes = await prisma.assetLogoType.findMany({
        where: {
          teamId,
        },
        select: {
          id: true,
        },
        orderBy: [{ sort: "asc" }, { id: "asc" }],
      });

      const activeIds = activeTypes.map((type) => type.id);

      if (
        activeIds.length !== uniqueOrderedIds.length ||
        activeIds.some((id) => !uniqueOrderedIds.includes(id))
      ) {
        return {
          success: false,
          message: "类型排序数据已过期，请刷新后重试",
        };
      }

      await prisma.$transaction(
        uniqueOrderedIds.map((id, index) =>
          prisma.assetLogoType.update({
            where: {
              id,
            },
            data: {
              sort: index + 1,
            },
          }),
        ),
      );

      return {
        success: true,
        data: {
          orderedIds: uniqueOrderedIds,
        },
      };
    } catch (error) {
      console.error("Failed to reorder asset logo types:", error);
      return {
        success: false,
        message: "更新类型顺序失败",
      };
    }
  });
}
