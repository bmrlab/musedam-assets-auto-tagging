"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { MAX_CLIENT_IMAGE_UPLOAD_BYTES } from "@/lib/brand/upload-constants";
import {
  buildAssetProductObjectKey,
  getCachedSignedOssObjectUrl,
  signOssObjectUploadUrl,
  uploadOssObject,
} from "@/lib/oss";
import {
  ProductDetectionBox,
  classifyProductImageCrops,
  detectProductFigureBoxes,
} from "@/lib/product/product-classification";
import {
  markAssetProductVectorsProcessing,
  processAssetProductReferenceVectors,
} from "@/lib/product/product-processing";
import {
  deleteProductVectorPointsByProduct,
  setProductVectorPayloadByProduct,
} from "@/lib/product/qdrant";
import { ServerActionResult } from "@/lib/serverAction";
import {
  clampBox as clampClassificationBox,
  cropImageToDataUrl as cropClassificationImageToDataUrl,
  fetchRemoteImageInput,
} from "@/lib/tagging/classification-image";
import { schedulePushFeatureToMuseDAM } from "@/musedam/push-feature-to-musedam";
import {
  AssetProduct,
  AssetProductImage,
  AssetProductTag,
  AssetProductType,
  AssetTag,
} from "@/prisma/client/index";
import prisma from "@/prisma/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import { after } from "next/server";
import { z } from "zod";
import {
  BatchFileErrorMessages,
  BatchFileFormat,
  encodeBatchFile,
  getBatchFileName,
  parseBatchFile,
  parseImportedEnabled,
  splitBatchValues,
} from "../batchFile";
import {
  ParsedProductBatchRow,
  buildProductBatchExportRows,
  buildProductBatchTemplateRows,
  getLocalizedProductBatchColumns,
  parseProductBatchRows,
} from "./batchFile";
import {
  ProductBatchFileResult,
  ProductBatchImportFailure,
  ProductBatchImportResult,
  ProductClassificationResult,
  ProductClassificationUploadResult,
  ProductImageItem,
  ProductItem,
  ProductLibraryPageData,
  ProductTagItem,
  ProductTagTreeNode,
  ProductTypeItem,
} from "./types";

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

function getProductBatchFileErrors(t: TranslationFunction): BatchFileErrorMessages {
  return {
    missingHeader: t("fileErrors.missingHeader"),
    noDataRows: t("fileErrors.noDataRows"),
    excelMissingWorksheet: t("fileErrors.excelMissingWorksheet"),
    excelInvalidStructure: t("fileErrors.excelInvalidStructure"),
    excelUnsupportedCompression: t("fileErrors.excelUnsupportedCompression"),
  };
}

async function getProductValidationMessages() {
  const t = await getTranslations("Tagging.ProductLibrary");
  return {
    nameRequired: t("validation.nameRequired"),
    nameTooLong: t("validation.nameTooLong"),
    tagsRequired: t("validation.tagsRequired"),
    typeNameRequired: t("productType.typeNameRequired"),
    typeNameTooLong: t("productType.typeNameTooLong"),
  };
}

async function getCreateOrUpdateProductSchema() {
  const messages = await getProductValidationMessages();
  return z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, messages.nameRequired).max(255, messages.nameTooLong),
    productTypeId: z.string().uuid(),
    description: z.string().max(5000).default(""),
    tagIds: z.array(z.number().int().positive()).min(1, messages.tagsRequired).max(100),
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
}

async function getProductTypeNameSchema() {
  const messages = await getProductValidationMessages();
  return z.string().trim().min(1, messages.typeNameRequired).max(100, messages.typeNameTooLong);
}

type AssetTagWithParents = AssetTag & {
  parent: (AssetTag & { parent: AssetTag | null }) | null;
};

type AssetProductRecord = AssetProduct & {
  images: AssetProductImage[];
  tags: AssetProductTag[];
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

function getFileExtensionFromNameOrContentType({
  name,
  contentType,
}: {
  name: string;
  contentType: string;
}) {
  const match = name.match(/\.[a-zA-Z0-9]+$/);
  if (match) {
    return match[0].toLowerCase();
  }

  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/svg+xml") return ".svg";
  if (contentType === "image/gif") return ".gif";
  return "";
}

function isTeamProductObjectKey(objectKey: string, teamId: number) {
  return objectKey.startsWith(`auto-tagging/teams-${teamId}-asset-products-`);
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

function normalizeProductType(type: AssetProductType): ProductTypeItem {
  return {
    id: type.id,
    name: type.name,
    sort: type.sort,
  };
}

function normalizeProductImage(image: AssetProductImage): ProductImageItem {
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

function normalizeProductTag(tag: AssetProductTag): ProductTagItem {
  return {
    id: tag.id,
    assetTagId: tag.assetTagId,
    tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
  };
}

function normalizeProduct(product: AssetProductRecord): ProductItem {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    productTypeId: product.productTypeId,
    productTypeName: product.productTypeName,
    description: product.description,
    generalCategory: product.generalCategory,
    status: product.status,
    processingError: product.processingError,
    processedAt: product.processedAt,
    enabled: product.enabled,
    notes: product.notes,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    images: product.images
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeProductImage),
    tags: product.tags
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeProductTag),
  };
}

function normalizeProductTagTreeNode(
  tag: AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] },
): ProductTagTreeNode {
  return {
    id: tag.id,
    name: tag.name,
    level: tag.level,
    parentId: tag.parentId,
    children: (tag.children ?? []).map((child) => normalizeProductTagTreeNode(child)),
  };
}

async function fetchActiveProductTypes(teamId: number) {
  return prisma.assetProductType.findMany({
    where: {
      teamId,
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
}

function getDefaultProductTypeNames(locale: string): string[] {
  const normalizedLocale = locale.toLowerCase().replace(/_/g, "-");

  if (normalizedLocale === "zh-cn" || normalizedLocale === "zh-tw") {
    return ["主推产品", "系列产品", "限定款", "联名款", "配件", "其他"];
  }

  return ["Hero Product", "Product Series", "Limited Edition", "Co-branded", "Accessory", "Other"];
}

async function ensureDefaultProductTypes(teamId: number, locale: string) {
  const existing = await fetchActiveProductTypes(teamId);
  if (existing.length > 0) {
    return existing;
  }

  const names = getDefaultProductTypeNames(locale);
  await prisma.assetProductType.createMany({
    data: names.map((name, index) => ({
      teamId,
      name,
      sort: index + 1,
    })),
  });

  return fetchActiveProductTypes(teamId);
}

function getProductBatchTranslator(t: TranslationFunction) {
  return (key: string, values?: Record<string, string | number>) =>
    t(`batchImportExport.${key}`, values);
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
  t: TranslationFunction;
}) {
  const tagPathValues = splitBatchValues(value);
  if (tagPathValues.length === 0) {
    throw new Error(t("importErrors.tagsRequired", { tagsColumn: t("columns.tagPaths") }));
  }

  if (tagPathValues.length > 100) {
    throw new Error(t("importErrors.tagsTooMany", { tagsColumn: t("columns.tagPaths") }));
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
      t("importErrors.tagsNotFound", {
        tagsColumn: t("columns.tagPaths"),
        tags: missingTagPaths.join(t("listSeparator")),
      }),
    );
  }

  return selectedTags;
}

function getUniqueImportedProductName(
  baseName: string,
  existingNames: Set<string>,
  t: TranslationFunction,
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

  throw new Error(t("importErrors.uniqueNameFailed", { nameColumn: t("columns.name") }));
}

async function ensureImportedProductType({
  teamId,
  name,
  productTypeCache,
}: {
  teamId: number;
  name: string;
  productTypeCache: Map<string, AssetProductType>;
}) {
  const cacheKey = name.toLowerCase();
  const cached = productTypeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existingType = await prisma.assetProductType.findFirst({
    where: {
      teamId,
      name,
    },
  });

  if (existingType) {
    productTypeCache.set(cacheKey, existingType);
    return existingType;
  }

  const lastType = await prisma.assetProductType.findFirst({
    where: {
      teamId,
    },
    orderBy: [{ sort: "desc" }, { id: "desc" }],
  });
  const productType = await prisma.assetProductType.create({
    data: {
      teamId,
      name,
      sort: (lastType?.sort ?? 0) + 1,
    },
  });

  productTypeCache.set(cacheKey, productType);
  return productType;
}

async function fetchProductTags(teamId: number) {
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

  return tags.map((tag) => normalizeProductTagTreeNode(tag));
}

async function fetchProducts(teamId: number) {
  const products = await prisma.assetProduct.findMany({
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

  return products.map((product) => normalizeProduct(product));
}

async function resolveProductType(teamId: number, productTypeId: string) {
  const t = await getTranslations("Tagging.ProductLibrary");
  const productType = await prisma.assetProductType.findFirst({
    where: {
      id: productTypeId,
      teamId,
    },
  });

  if (!productType) {
    throw new Error(t("validation.typeDeleted"));
  }

  return productType;
}

async function resolveSelectedTags(teamId: number, tagIds: number[]) {
  const t = await getTranslations("Tagging.ProductLibrary");
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
    throw new Error(t("validation.tagsRequired"));
  }

  const tagMap = new Map(tags.map((tag) => [tag.id, tag as AssetTagWithParents]));

  return uniqueTagIds.map((tagId, index) => {
    const tag = tagMap.get(tagId);
    if (!tag) {
      throw new Error(t("validation.tagsRequired"));
    }

    return {
      assetTagId: tag.id,
      sort: index + 1,
      tagPath: buildTagPath(tag),
    };
  });
}

async function uploadNewProductImages({ files, teamId }: { files: File[]; teamId: number }) {
  const t = await getTranslations("Tagging.BrandLibrary");
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
  }> = [];

  for (const file of files) {
    if (!isImageFile(file)) {
      throw new Error(`${file.name}: ${t("uploadErrors.imageLoadFailed")}`);
    }

    const objectKey = buildAssetProductObjectKey({
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
  const t = await getTranslations("Tagging.ProductLibrary");
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
  }> = [];

  for (const downloadUrl of downloadUrls) {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(t("uploadErrors.selectFromLibraryFailed"));
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = getImageExtensionFromUrlOrContentType({
      imageUrl: downloadUrl,
      contentType,
    });
    const objectKey = buildAssetProductObjectKey({
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

async function cloneProductImageFromObjectKey({
  objectKey,
  teamId,
  t,
}: {
  objectKey: string;
  teamId: number;
  t: TranslationFunction;
}) {
  const { signedUrl } = getCachedSignedOssObjectUrl({
    objectKey,
    expiresInSeconds: 60 * 60,
  });
  const response = await fetch(signedUrl);

  if (!response.ok) {
    throw new Error(
      t("importErrors.ossKeyUnreadable", {
        imageKeyColumn: t("columns.imageObjectKeys"),
        objectKey,
      }),
    );
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = getImageExtensionFromObjectKeyOrContentType({
    objectKey,
    contentType,
  });
  const newObjectKey = buildAssetProductObjectKey({
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

async function importProductBatchRow({
  team,
  row,
  tagLookup,
  productTypeCache,
  existingNames,
  t,
}: {
  team: { id: number; slug: string };
  row: ParsedProductBatchRow;
  tagLookup: Map<string, { assetTagId: number; tagPath: string[] }>;
  productTypeCache: Map<string, AssetProductType>;
  existingNames: Set<string>;
  t: TranslationFunction;
}) {
  const baseName = row.name.trim();
  const productTypeName = row.productTypeName.trim();
  const description = row.description.trim();
  const notes = row.notes.trim();
  const imageObjectKeys = splitBatchValues(row.imageObjectKeys);

  if (!baseName) {
    throw new Error(t("importErrors.nameRequired", { nameColumn: t("columns.name") }));
  }

  if (baseName.length > 255) {
    throw new Error(t("importErrors.nameTooLong", { nameColumn: t("columns.name") }));
  }

  if (!productTypeName) {
    throw new Error(t("importErrors.typeRequired", { typeColumn: t("columns.productTypeName") }));
  }

  if (productTypeName.length > 100) {
    throw new Error(t("importErrors.typeTooLong", { typeColumn: t("columns.productTypeName") }));
  }

  if (description.length > 5000) {
    throw new Error(
      t("importErrors.descriptionTooLong", { descriptionColumn: t("columns.description") }),
    );
  }

  if (notes.length > 5000) {
    throw new Error(t("importErrors.notesTooLong", { notesColumn: t("columns.notes") }));
  }

  if (imageObjectKeys.length === 0) {
    throw new Error(
      t("importErrors.imageKeysRequired", { imageKeyColumn: t("columns.imageObjectKeys") }),
    );
  }

  if (imageObjectKeys.length > 100) {
    throw new Error(
      t("importErrors.imagesTooMany", { imageKeyColumn: t("columns.imageObjectKeys") }),
    );
  }

  const selectedTags = resolveImportedTags({
    value: row.tagPaths,
    tagLookup,
    t,
  });
  const enabled = parseImportedEnabled({
    value: row.enabled,
    enabledLabel: t("enabledValue"),
    disabledLabel: t("disabledValue"),
    formatError: (enabledLabel, disabledLabel) =>
      t("importErrors.enabledInvalid", {
        enabled: enabledLabel,
        disabled: disabledLabel,
      }),
  });
  const uploadedImages = [];

  for (const objectKey of imageObjectKeys) {
    uploadedImages.push(
      await cloneProductImageFromObjectKey({
        objectKey,
        teamId: team.id,
        t,
      }),
    );
  }

  const productType = await ensureImportedProductType({
    teamId: team.id,
    name: productTypeName,
    productTypeCache,
  });
  const productName = getUniqueImportedProductName(baseName, existingNames, t);

  const createdProduct = await prisma.assetProduct.create({
    data: {
      teamId: team.id,
      name: productName,
      productTypeId: productType.id,
      productTypeName: productType.name,
      description,
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

  existingNames.add(productName);

  const product = await loadProduct(team.id, createdProduct.id);
  scheduleAssetProductProcessing(team.id, createdProduct.id);
  schedulePushFeatureToMuseDAM({
    team,
    featureType: "product",
    identifierId: product.id,
    identifierName: product.name,
    identifierTypeId: productType.id,
    identifierTypeName: productType.name,
    firstImageObjectKey: product.images[0]?.objectKey,
    internalAssetTagIds: selectedTags.map((tag) => tag.assetTagId),
  });

  return normalizeProduct(product);
}

type UploadedAssetLibraryImage = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type PreparedProductImageUpload = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  uploadUrl: string;
  uploadUrlExpiresAt: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type UploadedProductImageInput = {
  objectKey: string;
  mimeType: string;
  size: number;
};

async function validateUploadedProductImageObjectKeys({
  images,
  teamId,
}: {
  images: UploadedProductImageInput[];
  teamId: number;
}) {
  const t = await getTranslations("Tagging.ProductLibrary");

  for (const image of images) {
    if (!isTeamProductObjectKey(image.objectKey, teamId)) {
      throw new Error(t("uploadErrors.imageLoadFailed"));
    }
  }
}

function extractSubmittedImages(formData: FormData) {
  return formData
    .getAll("images")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0);
}

async function parseCreateOrUpdateInput(formData: FormData) {
  const schema = await getCreateOrUpdateProductSchema();
  return schema.parse({
    id: (() => {
      const idValue = formData.get("id");
      if (typeof idValue !== "string" || !idValue.trim()) {
        return undefined;
      }
      return idValue;
    })(),
    name: formData.get("name"),
    productTypeId: formData.get("productTypeId"),
    description: typeof formData.get("description") === "string" ? formData.get("description") : "",
    tagIds: parseJsonField<number[]>(formData.get("tagIds"), []),
    notes: typeof formData.get("notes") === "string" ? formData.get("notes") : "",
    existingImageIds: parseJsonField<string[]>(formData.get("existingImageIds"), []),
    assetLibraryDownloadUrls: parseJsonField<string[]>(
      formData.get("assetLibraryDownloadUrls"),
      [],
    ),
    assetLibraryUploadedImages: parseJsonField<UploadedProductImageInput[]>(
      formData.get("assetLibraryUploadedImages"),
      [],
    ),
  });
}

export async function prepareAssetLibraryProductImagesAction(
  assets: Array<{ name: string; downloadUrl: string }>,
): Promise<ServerActionResult<{ images: UploadedAssetLibraryImage[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const normalizedAssets = z
        .array(
          z.object({
            name: z.string().trim().min(1).max(255),
            downloadUrl: z.string().url(),
          }),
        )
        .min(1, t("uploadErrors.noAssetsSelected"))
        .max(100, "Maximum 100 assets per selection")
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
      console.error("Failed to prepare asset library Product images:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("uploadErrors.selectFromLibraryFailed"),
      };
    }
  });
}

export async function prepareProductImageUploadAction(input: {
  name: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<{ image: PreparedProductImageUpload }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const metadata = z
        .object({
          name: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(1).max(255),
          size: z.number().int().positive().max(MAX_CLIENT_IMAGE_UPLOAD_BYTES),
        })
        .parse(input);

      if (
        !metadata.mimeType.startsWith("image/") &&
        !metadata.name.toLowerCase().endsWith(".svg")
      ) {
        return {
          success: false,
          message: t("uploadErrors.imageLoadFailed"),
        };
      }

      const contentType = metadata.mimeType || "application/octet-stream";
      const objectKey = buildAssetProductObjectKey({
        teamId,
        extension: getFileExtensionFromNameOrContentType({
          name: metadata.name,
          contentType,
        }),
      });
      const { signedUrl: uploadUrl, signedUrlExpiresAt: uploadUrlExpiresAt } =
        signOssObjectUploadUrl({
          objectKey,
          contentType,
        });
      const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
        objectKey,
        expiresInSeconds: 60 * 60,
      });

      return {
        success: true,
        data: {
          image: {
            name: metadata.name,
            objectKey,
            mimeType: contentType,
            size: metadata.size,
            uploadUrl,
            uploadUrlExpiresAt,
            signedUrl,
            signedUrlExpiresAt,
          },
        },
      };
    } catch (error) {
      console.error("Failed to prepare Product image upload:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

async function loadProduct(teamId: number, productId: string) {
  const t = await getTranslations("Tagging.ProductLibrary");
  const product = await prisma.assetProduct.findFirst({
    where: {
      id: productId,
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

  if (!product) {
    throw new Error(t("processingErrors.productNotFound"));
  }

  return product;
}

async function loadProductsByIds(teamId: number, productIds: string[]) {
  if (productIds.length === 0) {
    return [];
  }

  const products = await prisma.assetProduct.findMany({
    where: {
      teamId,
      id: {
        in: productIds,
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

  return products.map((product) => normalizeProduct(product));
}

function scheduleAssetProductProcessing(teamId: number, productId: string) {
  after(async () => {
    try {
      await processAssetProductReferenceVectors({
        teamId,
        productId,
      });
    } catch (error) {
      console.error("Failed to process asset Product vectors:", error);
    }
  });
}

function getClassifyBoxSchema() {
  return z.object({
    xMin: z.number().finite(),
    yMin: z.number().finite(),
    xMax: z.number().finite(),
    yMax: z.number().finite(),
    score: z.number().finite(),
    label: z.string(),
  });
}

export async function refreshAssetProductImageSignedUrlAction(imageId: string): Promise<
  ServerActionResult<{
    imageId: string;
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const image = await prisma.assetProductImage.findFirst({
        where: {
          id: imageId,
          assetProduct: {
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
          message: t("uploadErrors.imageLoadFailed"),
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
      console.error("Failed to refresh asset Product image signed url:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

export async function fetchProductLibraryPageData(): Promise<
  ServerActionResult<ProductLibraryPageData>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const locale = await getLocale();
      const [products, productTypes, tags] = await Promise.all([
        fetchProducts(teamId),
        ensureDefaultProductTypes(teamId, locale),
        fetchProductTags(teamId),
      ]);

      return {
        success: true,
        data: {
          products,
          productTypes: productTypes.map(normalizeProductType),
          tags,
        },
      };
    } catch (error) {
      console.error("Failed to fetch Product library data:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function exportProductsAction(
  format: BatchFileFormat,
): Promise<ServerActionResult<ProductBatchFileResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const products = await fetchProducts(teamId);
      const rows = buildProductBatchExportRows({
        products,
        columns: await getLocalizedProductBatchColumns(),
      });
      const { buffer, mimeType } = encodeBatchFile({
        rows,
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: getBatchFileName("product-library", parsedFormat),
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to export products:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("exportFailed"),
      };
    }
  });
}

export async function downloadProductImportTemplateAction(
  format: BatchFileFormat = "xlsx",
): Promise<ServerActionResult<ProductBatchFileResult>> {
  return withAuth(async () => {
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const columns = await getLocalizedProductBatchColumns();
      const { buffer, mimeType } = encodeBatchFile({
        rows: buildProductBatchTemplateRows(columns),
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: `product-import-template.${parsedFormat}`,
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to build product import template:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("templateDownloadFailed"),
      };
    }
  });
}

export async function importProductsAction(
  formData: FormData,
): Promise<ServerActionResult<ProductBatchImportResult>> {
  return withAuth(async ({ team }) => {
    const t = getProductBatchTranslator(
      (await getTranslations("Tagging.ProductLibrary")) as TranslationFunction,
    );
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;
    const fileErrors = getProductBatchFileErrors(tBatch);
    const columns = await getLocalizedProductBatchColumns();

    try {
      const file = formData.get("file");

      if (!(file instanceof File) || file.size <= 0) {
        return {
          success: false,
          message: tBatch("selectImportFile"),
        };
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const tableRows = parseBatchFile({
        file,
        buffer,
        fileErrors,
        unsupportedFileTypeMessage: tBatch("unsupportedFileType"),
      });
      const parsedRows = parseProductBatchRows({
        rows: tableRows,
        columns,
        fileErrors,
        listSeparator: t("listSeparator"),
        formatMissingRequiredColumns: (columnNames) =>
          tBatch("fileErrors.missingRequiredColumns", { columns: columnNames }),
      });
      const productTypes = await fetchActiveProductTypes(team.id);

      if (parsedRows.errors.length > 0) {
        return {
          success: true,
          data: {
            createdProducts: [],
            productTypes: productTypes.map(normalizeProductType),
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

      const [tagLookup, existingProducts, activeProductTypes] = await Promise.all([
        buildTagPathLookup(team.id),
        prisma.assetProduct.findMany({
          where: {
            teamId: team.id,
          },
          select: {
            name: true,
          },
        }),
        fetchActiveProductTypes(team.id),
      ]);
      const existingNames = new Set(existingProducts.map((product) => product.name));
      const productTypeCache = new Map(
        activeProductTypes.map(
          (productType) => [productType.name.toLowerCase(), productType] as const,
        ),
      );
      const createdProducts: ProductItem[] = [];
      const failures: ProductBatchImportFailure[] = [];

      for (const row of parsedRows.records) {
        try {
          const product = await importProductBatchRow({
            team,
            row,
            tagLookup,
            productTypeCache,
            existingNames,
            t,
          });
          createdProducts.push(product);
        } catch (error) {
          failures.push({
            rowNumber: row.rowNumber,
            name: row.name.trim() || null,
            message: error instanceof Error ? error.message : tBatch("rowImportFailed"),
          });
        }
      }

      const nextProductTypes = await fetchActiveProductTypes(team.id);

      return {
        success: true,
        data: {
          createdProducts,
          productTypes: nextProductTypes.map(normalizeProductType),
          successCount: createdProducts.length,
          failedCount: failures.length,
          skippedCount: 0,
          failures,
        },
      };
    } catch (error) {
      console.error("Failed to import products:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("importFailed"),
      };
    }
  });
}

export async function prepareProductClassificationAction(input: {
  objectKey: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<ProductClassificationUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductClassify");
      const metadata = z
        .object({
          objectKey: z.string().trim().min(1),
          mimeType: z.string().trim().min(1).max(255),
          size: z.number().int().positive().max(MAX_CLIENT_IMAGE_UPLOAD_BYTES),
        })
        .parse(input);

      if (!isTeamProductObjectKey(metadata.objectKey, teamId)) {
        return {
          success: false,
          message: t("errors.imageLoadFailed"),
        };
      }

      if (
        !metadata.mimeType.startsWith("image/") &&
        !metadata.objectKey.toLowerCase().endsWith(".svg")
      ) {
        return {
          success: false,
          message: t("errors.imageLoadFailed"),
        };
      }

      const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
        objectKey: metadata.objectKey,
        expiresInSeconds: 60 * 60,
      });
      const detection = await detectProductFigureBoxes({
        teamId,
        imageUrl: signedUrl,
      });

      return {
        success: true,
        data: {
          objectKey: metadata.objectKey,
          signedUrl,
          signedUrlExpiresAt,
          detections: detection.detections,
          found: detection.found,
        },
      };
    } catch (error) {
      console.error("Failed to prepare Product classification:", error);
      const t = await getTranslations("Tagging.ProductClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("errors.processingFailed"),
      };
    }
  });
}

export async function classifyProductImageAction(input: {
  objectKey: string;
  mimeType: string;
  size: number;
  boxes: ProductDetectionBox[];
}): Promise<ServerActionResult<{ result: ProductClassificationResult }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductClassify");
      const classifyBoxSchema = getClassifyBoxSchema();
      const metadata = z
        .object({
          objectKey: z.string().trim().min(1),
          mimeType: z.string().trim().min(1).max(255),
          size: z.number().int().positive().max(MAX_CLIENT_IMAGE_UPLOAD_BYTES),
          boxes: z.array(classifyBoxSchema).min(1, t("uploadImageFirst")),
        })
        .parse(input);

      if (!isTeamProductObjectKey(metadata.objectKey, teamId)) {
        return {
          success: false,
          message: t("errors.imageLoadFailed"),
        };
      }

      if (
        !metadata.mimeType.startsWith("image/") &&
        !metadata.objectKey.toLowerCase().endsWith(".svg")
      ) {
        return {
          success: false,
          message: t("errors.imageLoadFailed"),
        };
      }

      const { signedUrl } = getCachedSignedOssObjectUrl({
        objectKey: metadata.objectKey,
        expiresInSeconds: 60 * 60,
      });
      const imageInput = await fetchRemoteImageInput(signedUrl, "product classification upload");
      const crops = await Promise.all(
        metadata.boxes.map(async (box) => {
          const normalizedBox = clampClassificationBox(box, imageInput);

          return {
            box: normalizedBox,
            image: await cropClassificationImageToDataUrl({
              imageDataUrl: imageInput.dataUrl,
              imageBuffer: imageInput.buffer,
              sourceMimeType: imageInput.mimeType,
              meta: imageInput,
              box: normalizedBox,
            }),
          };
        }),
      );

      const result = await classifyProductImageCrops({
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
      console.error("Failed to classify Product image:", error);
      const t = await getTranslations("Tagging.ProductClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("classifyFailed"),
      };
    }
  });
}

export async function createAssetProductAction(
  formData: FormData,
): Promise<ServerActionResult<{ product: ProductItem }>> {
  return withAuth(async ({ team }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const input = await parseCreateOrUpdateInput(formData);
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

      const [productType, selectedTags] = await Promise.all([
        resolveProductType(team.id, input.productTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uploadedImages = await uploadNewProductImages({
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
      await validateUploadedProductImageObjectKeys({
        images: allUploadedImages,
        teamId: team.id,
      });

      const createdProduct = await prisma.assetProduct.create({
        data: {
          teamId: team.id,
          name: input.name,
          productTypeId: productType.id,
          productTypeName: productType.name,
          description: input.description.trim(),
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

      const product = await loadProduct(team.id, createdProduct.id);
      scheduleAssetProductProcessing(team.id, createdProduct.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "product",
        identifierId: product.id,
        identifierName: product.name,
        identifierTypeId: productType.id,
        identifierTypeName: productType.name,
        firstImageObjectKey: product.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          product: normalizeProduct(product),
        },
      };
    } catch (error) {
      console.error("Failed to create asset Product:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("createFailed"),
      };
    }
  });
}

export async function updateAssetProductAction(
  formData: FormData,
): Promise<ServerActionResult<{ product: ProductItem }>> {
  return withAuth(async ({ team }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const input = await parseCreateOrUpdateInput(formData);
      if (!input.id) {
        return {
          success: false,
          message: t("validation.missingId"),
        };
      }

      const product = await prisma.assetProduct.findFirst({
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

      if (!product) {
        return {
          success: false,
          message: t("processingErrors.productNotFound"),
        };
      }

      const files = extractSubmittedImages(formData);
      const assetLibraryDownloadUrls = Array.from(new Set(input.assetLibraryDownloadUrls));
      const assetLibraryUploadedImages = input.assetLibraryUploadedImages;
      const [productType, selectedTags] = await Promise.all([
        resolveProductType(team.id, input.productTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uniqueExistingImageIds = Array.from(new Set(input.existingImageIds));
      const retainedImages = product.images.filter((image) =>
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

      const uploadedImages = await uploadNewProductImages({
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
      await validateUploadedProductImageObjectKeys({
        images: allUploadedImages,
        teamId: team.id,
      });

      await prisma.$transaction(async (tx) => {
        await tx.assetProduct.update({
          where: {
            id: product.id,
          },
          data: {
            name: input.name,
            productTypeId: productType.id,
            productTypeName: productType.name,
            description: input.description.trim(),
            notes: input.notes,
            status: "processing",
            processingError: null,
            processedAt: null,
          },
        });

        await tx.assetProductImage.deleteMany({
          where: {
            assetProductId: product.id,
            id: {
              notIn: retainedImages.map((image) => image.id),
            },
          },
        });

        await tx.assetProductTag.deleteMany({
          where: {
            assetProductId: product.id,
          },
        });

        const finalImages = [...retainedImages, ...allUploadedImages];

        for (let index = 0; index < retainedImages.length; index += 1) {
          await tx.assetProductImage.update({
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
          await tx.assetProductImage.createMany({
            data: allUploadedImages.map((image, index) => ({
              assetProductId: product.id,
              ...image,
              sort: retainedImages.length + index + 1,
            })),
          });
        }

        if (selectedTags.length > 0) {
          await tx.assetProductTag.createMany({
            data: selectedTags.map((tag) => ({
              assetProductId: product.id,
              assetTagId: tag.assetTagId,
              sort: tag.sort,
              tagPath: tag.tagPath,
            })),
          });
        }

        if (finalImages.length === 0) {
          throw new Error(t("validation.keepAtLeastOneImage"));
        }
      });

      await setProductVectorPayloadByProduct({
        teamId: team.id,
        assetProductId: product.id,
        payload: {
          enabled: product.enabled,
          status: "processing",
        },
      }).catch((error) => {
        console.warn("Failed to mark Product vectors as processing:", error);
      });

      const updatedProduct = await loadProduct(team.id, product.id);
      scheduleAssetProductProcessing(team.id, product.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "product",
        identifierId: updatedProduct.id,
        identifierName: updatedProduct.name,
        identifierTypeId: productType.id,
        identifierTypeName: productType.name,
        firstImageObjectKey: updatedProduct.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          product: normalizeProduct(updatedProduct),
        },
      };
    } catch (error) {
      console.error("Failed to update asset Product:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("updateFailed"),
      };
    }
  });
}

export async function setAssetProductEnabledAction(
  productId: string,
  enabled: boolean,
): Promise<ServerActionResult<{ product: ProductItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const product = await prisma.assetProduct.findFirst({
        where: {
          id: productId,
          teamId,
        },
      });

      if (!product) {
        return {
          success: false,
          message: t("processingErrors.productNotFound"),
        };
      }

      await prisma.assetProduct.update({
        where: {
          id: productId,
        },
        data: {
          enabled,
        },
      });

      await setProductVectorPayloadByProduct({
        teamId,
        assetProductId: productId,
        payload: {
          enabled,
        },
      }).catch((error) => {
        console.warn("Failed to sync Product enabled payload to Qdrant:", error);
      });

      const updatedProduct = await loadProduct(teamId, productId);

      return {
        success: true,
        data: {
          product: normalizeProduct(updatedProduct),
        },
      };
    } catch (error) {
      console.error("Failed to toggle asset Product enabled:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: t("toggleEnabledFailed"),
      };
    }
  });
}

export async function deleteAssetProductAction(
  productId: string,
): Promise<ServerActionResult<{ productId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.ProductLibrary");
      const product = await prisma.assetProduct.findFirst({
        where: {
          id: productId,
          teamId,
        },
      });

      if (!product) {
        return {
          success: false,
          message: t("processingErrors.productNotFound"),
        };
      }

      await prisma.assetProduct.delete({
        where: {
          id: productId,
        },
      });

      await deleteProductVectorPointsByProduct({
        teamId,
        assetProductId: productId,
      }).catch(() => undefined);

      return {
        success: true,
        data: {
          productId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset Product:", error);
      const t = await getTranslations("Tagging.ProductLibrary");
      return {
        success: false,
        message: t("deleteFailed"),
      };
    }
  });
}

export async function retryAssetProductProcessingAction(
  productId: string,
): Promise<ServerActionResult<{ product: ProductItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const product = await prisma.assetProduct.findFirst({
        where: {
          id: productId,
          teamId,
        },
      });

      if (!product) {
        return {
          success: false,
          message: t("processingErrors.productNotFound"),
        };
      }

      if (product.status !== "failed") {
        return {
          success: false,
          message: t("retryOnlyFailed"),
        };
      }

      await markAssetProductVectorsProcessing({
        teamId,
        productId,
        enabled: product.enabled,
      });

      const updatedProduct = await loadProduct(teamId, productId);
      scheduleAssetProductProcessing(teamId, productId);

      return {
        success: true,
        data: {
          product: normalizeProduct(updatedProduct),
        },
      };
    } catch (error) {
      console.error("Failed to retry asset Product processing:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("retryFailed"),
      };
    }
  });
}

export async function pollProductsAction(
  productIds: string[],
): Promise<ServerActionResult<{ products: ProductItem[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const uniqueIds = Array.from(new Set(productIds)).filter(
        (id) => typeof id === "string" && id.length > 0,
      );
      const products = await loadProductsByIds(teamId, uniqueIds);

      return {
        success: true,
        data: {
          products,
        },
      };
    } catch (error) {
      console.error("Failed to poll Products:", error);
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function createAssetProductTypeAction(
  name: string,
): Promise<ServerActionResult<{ productType: ProductTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const productTypeNameSchema = await getProductTypeNameSchema();
      const parsedName = productTypeNameSchema.parse(name);

      const existingType = await prisma.assetProductType.findFirst({
        where: {
          teamId,
          name: parsedName,
        },
      });

      if (existingType) {
        return {
          success: false,
          message: t("productType.duplicated"),
        };
      }

      const lastType = await prisma.assetProductType.findFirst({
        where: {
          teamId,
        },
        orderBy: [{ sort: "desc" }, { id: "desc" }],
      });

      const productType = await prisma.assetProductType.create({
        data: {
          teamId,
          name: parsedName,
          sort: (lastType?.sort ?? 0) + 1,
        },
      });

      return {
        success: true,
        data: {
          productType: normalizeProductType(productType),
        },
      };
    } catch (error) {
      console.error("Failed to create asset Product type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("productType.created"),
      };
    }
  });
}

export async function updateAssetProductTypeAction(
  productTypeId: string,
  name: string,
): Promise<ServerActionResult<{ productType: ProductTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const productTypeNameSchema = await getProductTypeNameSchema();
      const parsedName = productTypeNameSchema.parse(name);

      const productType = await prisma.assetProductType.findFirst({
        where: {
          id: productTypeId,
          teamId,
        },
      });

      if (!productType) {
        return {
          success: false,
          message: t("productType.deleted"),
        };
      }

      const duplicatedType = await prisma.assetProductType.findFirst({
        where: {
          teamId,
          name: parsedName,
          id: {
            not: productTypeId,
          },
        },
      });

      if (duplicatedType) {
        return {
          success: false,
          message: t("productType.duplicated"),
        };
      }

      const updatedType = await prisma.$transaction(async (tx) => {
        const nextType = await tx.assetProductType.update({
          where: {
            id: productTypeId,
          },
          data: {
            name: parsedName,
          },
        });

        await tx.assetProduct.updateMany({
          where: {
            teamId,
            productTypeId,
          },
          data: {
            productTypeName: parsedName,
          },
        });

        return nextType;
      });

      return {
        success: true,
        data: {
          productType: normalizeProductType(updatedType),
        },
      };
    } catch (error) {
      console.error("Failed to update asset Product type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("productType.updated"),
      };
    }
  });
}

export async function softDeleteAssetProductTypeAction(
  productTypeId: string,
): Promise<ServerActionResult<{ productTypeId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const productType = await prisma.assetProductType.findFirst({
        where: {
          id: productTypeId,
          teamId,
        },
      });

      if (!productType) {
        return {
          success: false,
          message: t("productType.deleted"),
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.assetProductType.delete({
          where: {
            id: productTypeId,
          },
        });

        const remainingTypes = await tx.assetProductType.findMany({
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
            tx.assetProductType.update({
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
          productTypeId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset Product type:", error);
      return {
        success: false,
        message: t("productType.deleted"),
      };
    }
  });
}

export async function reorderAssetProductTypesAction(
  orderedIds: string[],
): Promise<ServerActionResult<{ orderedIds: string[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.ProductLibrary");
    try {
      const uniqueOrderedIds = Array.from(new Set(orderedIds));

      const activeTypes = await prisma.assetProductType.findMany({
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
          message: t("productType.reorderFailed"),
        };
      }

      await prisma.$transaction(
        uniqueOrderedIds.map((id, index) =>
          prisma.assetProductType.update({
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
      console.error("Failed to reorder asset Product types:", error);
      return {
        success: false,
        message: t("productType.reorderFailed"),
      };
    }
  });
}
