"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { MAX_CLIENT_IMAGE_UPLOAD_BYTES } from "@/lib/brand/upload-constants";
import {
  classifyPersonFaceEmbeddings,
  detectPersonFaceBoxes,
  PersonDetectionBox,
} from "@/lib/person/person-classification";
import {
  assertSingleFaceReferenceImage,
  markAssetPersonVectorsProcessing,
  processAssetPersonReferenceVectors,
} from "@/lib/person/person-processing";
import {
  deletePersonVectorPointsByPerson,
  setPersonVectorPayloadByPerson,
} from "@/lib/person/qdrant";
import {
  buildAssetPersonObjectKey,
  getBrowserS3ObjectUploadUrl,
  getCachedBrowserS3ObjectUrl,
  getCachedSignedS3ObjectUrl,
  isTeamS3ObjectKey,
  uploadS3Object,
} from "@/lib/s3";
import { ServerActionResult } from "@/lib/serverAction";
import { fetchRemoteImageInput } from "@/lib/tagging/classification-image";
import { schedulePushFeatureToMuseDAM } from "@/musedam/push-feature-to-musedam";
import {
  AssetPerson,
  AssetPersonImage,
  AssetPersonTag,
  AssetPersonType,
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
  buildPersonBatchExportRows,
  buildPersonBatchTemplateRows,
  getLocalizedPersonBatchColumns,
  ParsedPersonBatchRow,
  parsePersonBatchRows,
} from "./batchFile";
import {
  PersonBatchFileResult,
  PersonBatchImportFailure,
  PersonBatchImportResult,
  PersonClassificationResult,
  PersonClassificationUploadResult,
  PersonImageItem,
  PersonItem,
  PersonLibraryPageData,
  PersonTagItem,
  PersonTagTreeNode,
  PersonTypeItem,
} from "./types";

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

function getPersonBatchFileErrors(t: TranslationFunction): BatchFileErrorMessages {
  return {
    missingHeader: t("fileErrors.missingHeader"),
    noDataRows: t("fileErrors.noDataRows"),
    excelMissingWorksheet: t("fileErrors.excelMissingWorksheet"),
    excelInvalidStructure: t("fileErrors.excelInvalidStructure"),
    excelUnsupportedCompression: t("fileErrors.excelUnsupportedCompression"),
  };
}

async function getPersonValidationMessages() {
  const t = await getTranslations("Tagging.PersonLibrary");
  return {
    nameRequired: t("validation.nameRequired"),
    nameTooLong: t("validation.nameTooLong"),
    tagsRequired: t("validation.tagsRequired"),
    typeNameRequired: t("personType.typeNameRequired"),
    typeNameTooLong: t("personType.typeNameTooLong"),
  };
}

async function getCreateOrUpdatePersonSchema() {
  const messages = await getPersonValidationMessages();
  return z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, messages.nameRequired).max(255, messages.nameTooLong),
    personTypeId: z.string().uuid(),
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
          name: z.string().optional(),
        }),
      )
      .max(100)
      .default([]),
  });
}

async function getPersonTypeNameSchema() {
  const messages = await getPersonValidationMessages();
  return z.string().trim().min(1, messages.typeNameRequired).max(100, messages.typeNameTooLong);
}

type AssetTagWithParents = AssetTag & {
  parent: (AssetTag & { parent: AssetTag | null }) | null;
};

type AssetPersonRecord = AssetPerson & {
  images: AssetPersonImage[];
  tags: AssetPersonTag[];
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

function isTeamPersonObjectKey(objectKey: string, teamId: number) {
  return isTeamS3ObjectKey({ kind: "persons", objectKey, teamId });
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

function normalizePersonType(type: AssetPersonType): PersonTypeItem {
  return {
    id: type.id,
    name: type.name,
    sort: type.sort,
  };
}

function normalizePersonImage(image: AssetPersonImage): PersonImageItem {
  const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
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

function normalizePersonTag(tag: AssetPersonTag): PersonTagItem {
  return {
    id: tag.id,
    assetTagId: tag.assetTagId,
    tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
  };
}

function normalizePerson(person: AssetPersonRecord): PersonItem {
  return {
    id: person.id,
    slug: person.slug,
    name: person.name,
    personTypeId: person.personTypeId,
    personTypeName: person.personTypeName,
    status: person.status,
    processingError: person.processingError,
    processedAt: person.processedAt,
    enabled: person.enabled,
    notes: person.notes,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    images: person.images
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizePersonImage),
    tags: person.tags
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizePersonTag),
  };
}

function normalizePersonTagTreeNode(
  tag: AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] },
): PersonTagTreeNode {
  return {
    id: tag.id,
    name: tag.name,
    level: tag.level,
    parentId: tag.parentId,
    children: (tag.children ?? []).map((child) => normalizePersonTagTreeNode(child)),
  };
}

async function fetchActivePersonTypes(teamId: number) {
  return prisma.assetPersonType.findMany({
    where: {
      teamId,
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
}

function getDefaultPersonTypeNames(locale: string): string[] {
  const normalizedLocale = locale.toLowerCase().replace(/_/g, "-");

  const defaults: Record<string, string[]> = {
    "zh-cn": ["品牌代言人", "品牌大使", "企业高管", "KOL", "模特", "其他"],
    "zh-tw": ["品牌代言人", "品牌大使", "企業高管", "KOL", "模特", "其他"],
    "en-us": ["Brand Endorser", "Brand Ambassador", "Executive", "KOL", "Model", "Other"],
  };

  return defaults[normalizedLocale] || defaults["en-us"]!;
}

async function ensureDefaultPersonTypes(teamId: number, locale: string) {
  const existing = await fetchActivePersonTypes(teamId);
  if (existing.length > 0) {
    return existing;
  }

  const names = getDefaultPersonTypeNames(locale);
  await prisma.assetPersonType.createMany({
    data: names.map((name, index) => ({
      teamId,
      name,
      sort: index + 1,
    })),
  });

  return fetchActivePersonTypes(teamId);
}

function getPersonBatchTranslator(t: TranslationFunction) {
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

function getUniqueImportedPersonName(
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

async function ensureImportedPersonType({
  teamId,
  name,
  personTypeCache,
}: {
  teamId: number;
  name: string;
  personTypeCache: Map<string, AssetPersonType>;
}) {
  const cacheKey = name.toLowerCase();
  const cached = personTypeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const existingType = await prisma.assetPersonType.findFirst({
    where: {
      teamId,
      name,
    },
  });

  if (existingType) {
    personTypeCache.set(cacheKey, existingType);
    return existingType;
  }

  const lastType = await prisma.assetPersonType.findFirst({
    where: {
      teamId,
    },
    orderBy: [{ sort: "desc" }, { id: "desc" }],
  });
  const personType = await prisma.assetPersonType.create({
    data: {
      teamId,
      name,
      sort: (lastType?.sort ?? 0) + 1,
    },
  });

  personTypeCache.set(cacheKey, personType);
  return personType;
}

async function fetchPersonTags(teamId: number) {
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

  return tags.map((tag) => normalizePersonTagTreeNode(tag));
}

async function fetchPersons(teamId: number) {
  const persons = await prisma.assetPerson.findMany({
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

  return persons.map((ip) => normalizePerson(ip));
}

async function resolvePersonType(teamId: number, personTypeId: string) {
  const t = await getTranslations("Tagging.PersonLibrary");
  const personType = await prisma.assetPersonType.findFirst({
    where: {
      id: personTypeId,
      teamId,
    },
  });

  if (!personType) {
    throw new Error(t("validation.typeDeleted"));
  }

  return personType;
}

async function resolveSelectedTags(teamId: number, tagIds: number[]) {
  const t = await getTranslations("Tagging.PersonLibrary");
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

async function uploadNewPersonImages({ files, teamId }: { files: File[]; teamId: number }) {
  const t = await getTranslations("Tagging.PersonLibrary");
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
    name: string;
  }> = [];

  for (const file of files) {
    if (!isImageFile(file)) {
      throw new Error(`${file.name}: ${t("uploadErrors.imageLoadFailed")}`);
    }

    const objectKey = buildAssetPersonObjectKey({
      teamId,
      extension: getFileExtension(file),
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadResult = await uploadS3Object({
      body: buffer,
      contentType: file.type || "application/octet-stream",
      objectKey,
    });

    uploads.push({
      objectKey: uploadResult.objectKey,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      name: file.name,
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
  assets,
  teamId,
}: {
  assets: Array<{ downloadUrl: string; name?: string }>;
  teamId: number;
}) {
  const t = await getTranslations("Tagging.PersonLibrary");
  const uploads: Array<{
    objectKey: string;
    mimeType: string;
    size: number;
    name: string;
  }> = [];

  for (const asset of assets) {
    const response = await fetch(asset.downloadUrl);
    if (!response.ok) {
      throw new Error(t("uploadErrors.selectFromLibraryFailed"));
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = getImageExtensionFromUrlOrContentType({
      imageUrl: asset.downloadUrl,
      contentType,
    });
    const objectKey = buildAssetPersonObjectKey({
      teamId,
      extension,
    });

    const uploadResult = await uploadS3Object({
      body: buffer,
      contentType,
      objectKey,
    });

    // Extract filename from URL if name not provided
    let assetName = asset.name;
    if (!assetName) {
      try {
        const url = new URL(asset.downloadUrl);
        const pathname = url.pathname;
        assetName = pathname.substring(pathname.lastIndexOf("/") + 1) || "unknown";
      } catch {
        assetName = "unknown";
      }
    }

    uploads.push({
      objectKey: uploadResult.objectKey,
      mimeType: contentType,
      size: buffer.byteLength,
      name: assetName,
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

async function clonePersonImageFromObjectKey({
  objectKey,
  teamId,
  t,
}: {
  objectKey: string;
  teamId: number;
  t: TranslationFunction;
}) {
  const { signedUrl } = getCachedSignedS3ObjectUrl({
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
  const newObjectKey = buildAssetPersonObjectKey({
    teamId,
    extension,
  });

  const uploadResult = await uploadS3Object({
    body: buffer,
    contentType,
    objectKey: newObjectKey,
  });

  return {
    objectKey: uploadResult.objectKey,
    mimeType: contentType,
    size: buffer.byteLength,
    name: objectKey,
  };
}

type UploadedAssetLibraryImage = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type PreparedPersonImageUpload = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  uploadUrl: string;
  uploadUrlExpiresAt: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type UploadedPersonImage = {
  objectKey: string;
  mimeType: string;
  size: number;
  name?: string;
};

async function validateUploadedPersonImageObjectKeys({
  images,
  teamId,
}: {
  images: UploadedPersonImage[];
  teamId: number;
}) {
  const t = await getTranslations("Tagging.PersonLibrary");

  for (const image of images) {
    if (!isTeamPersonObjectKey(image.objectKey, teamId)) {
      throw new Error(t("uploadErrors.imageLoadFailed"));
    }
  }
}

async function validateSingleFaceReferenceImages(images: UploadedPersonImage[]) {
  for (const image of images) {
    try {
      await assertSingleFaceReferenceImage({
        objectKey: image.objectKey,
        identifier: image.name || image.objectKey,
      });
    } catch (error) {
      const personError = error as Error & {
        identifier?: string;
        actualFaceCount?: number;
        personProcessingErrorCode?: string;
      };
      if (personError.personProcessingErrorCode === "face_count_not_one") {
        const enhancedError = new Error(personError.message) as Error & {
          identifier?: string;
          actualFaceCount?: number;
          personProcessingErrorCode?: string;
        };
        enhancedError.identifier = personError.identifier;
        enhancedError.actualFaceCount = personError.actualFaceCount;
        enhancedError.personProcessingErrorCode = personError.personProcessingErrorCode;
        throw enhancedError;
      }
      throw error;
    }
  }
}

function getReferenceValidationErrorMessage(error: unknown, t: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  const translate = t as (key: string, values?: Record<string, string | number>) => string;
  const personError = error as Error & {
    identifier?: string;
    actualFaceCount?: number;
  };

  switch (error.message) {
    case "face_count_not_one": {
      const identifier = personError.identifier || "image";
      const faceCount = personError.actualFaceCount ?? 0;
      return translate("processingErrors.faceCountNotOne", {
        identifier,
        count: faceCount,
      });
    }
    case "face_detection_failed":
      return translate("processingErrors.faceDetectionFailed");
    case "generate_embedding_failed":
      return translate("processingErrors.generateEmbeddingFailed");
    default:
      return null;
  }
}

async function importPersonBatchRow({
  team,
  row,
  tagLookup,
  personTypeCache,
  existingNames,
  t,
}: {
  team: { id: number; slug: string };
  row: ParsedPersonBatchRow;
  tagLookup: Map<string, { assetTagId: number; tagPath: string[] }>;
  personTypeCache: Map<string, AssetPersonType>;
  existingNames: Set<string>;
  t: TranslationFunction;
}) {
  const baseName = row.name.trim();
  const personTypeName = row.personTypeName.trim();
  const notes = row.notes.trim();
  const imageObjectKeys = splitBatchValues(row.imageObjectKeys);

  if (!baseName) {
    throw new Error(t("importErrors.nameRequired", { nameColumn: t("columns.name") }));
  }

  if (baseName.length > 255) {
    throw new Error(t("importErrors.nameTooLong", { nameColumn: t("columns.name") }));
  }

  if (!personTypeName) {
    throw new Error(t("importErrors.typeRequired", { typeColumn: t("columns.personTypeName") }));
  }

  if (personTypeName.length > 100) {
    throw new Error(t("importErrors.typeTooLong", { typeColumn: t("columns.personTypeName") }));
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
      await clonePersonImageFromObjectKey({
        objectKey,
        teamId: team.id,
        t,
      }),
    );
  }

  await validateSingleFaceReferenceImages(uploadedImages);

  const personType = await ensureImportedPersonType({
    teamId: team.id,
    name: personTypeName,
    personTypeCache,
  });
  const personName = getUniqueImportedPersonName(baseName, existingNames, t);

  const createdPerson = await prisma.assetPerson.create({
    data: {
      teamId: team.id,
      name: personName,
      personTypeId: personType.id,
      personTypeName: personType.name,
      notes,
      status: "processing",
      processingError: null,
      enabled,
      images: {
        create: uploadedImages.map((image, index) => ({
          objectKey: image.objectKey,
          mimeType: image.mimeType,
          size: image.size,
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

  existingNames.add(personName);

  const person = await loadPerson(team.id, createdPerson.id);
  scheduleAssetPersonProcessing(team.id, createdPerson.id);
  schedulePushFeatureToMuseDAM({
    team,
    featureType: "person",
    identifierId: person.id,
    identifierName: person.name,
    identifierTypeId: personType.id,
    identifierTypeName: personType.name,
    firstImageObjectKey: person.images[0]?.objectKey,
    internalAssetTagIds: selectedTags.map((tag) => tag.assetTagId),
  });

  return normalizePerson(person);
}

function extractSubmittedImages(formData: FormData) {
  return formData
    .getAll("images")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0);
}

async function parseCreateOrUpdateInput(formData: FormData) {
  const schema = await getCreateOrUpdatePersonSchema();
  return schema.parse({
    id: (() => {
      const idValue = formData.get("id");
      if (typeof idValue !== "string" || !idValue.trim()) {
        return undefined;
      }
      return idValue;
    })(),
    name: formData.get("name"),
    personTypeId: formData.get("personTypeId"),
    tagIds: parseJsonField<number[]>(formData.get("tagIds"), []),
    notes: typeof formData.get("notes") === "string" ? formData.get("notes") : "",
    existingImageIds: parseJsonField<string[]>(formData.get("existingImageIds"), []),
    assetLibraryDownloadUrls: parseJsonField<string[]>(
      formData.get("assetLibraryDownloadUrls"),
      [],
    ),
    assetLibraryUploadedImages: parseJsonField<
      Array<{ objectKey: string; mimeType: string; size: number; name?: string }>
    >(formData.get("assetLibraryUploadedImages"), []),
  });
}

export async function prepareAssetLibraryPersonImagesAction(
  assets: Array<{ name: string; downloadUrl: string }>,
): Promise<ServerActionResult<{ images: UploadedAssetLibraryImage[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
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
            assets: [{ downloadUrl: asset.downloadUrl, name: asset.name }],
            teamId,
          });
          const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
            objectKey: uploaded.objectKey,
          });

          return {
            name: uploaded.name,
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
      console.error("Failed to prepare asset library Person images:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("uploadErrors.selectFromLibraryFailed"),
      };
    }
  });
}

export async function preparePersonImageUploadAction(input: {
  name: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<{ image: PreparedPersonImageUpload }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
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
      const objectKey = buildAssetPersonObjectKey({
        teamId,
        extension: getFileExtensionFromNameOrContentType({
          name: metadata.name,
          contentType,
        }),
      });
      const { signedUrl: uploadUrl, signedUrlExpiresAt: uploadUrlExpiresAt } =
        getBrowserS3ObjectUploadUrl({
          objectKey,
          contentType,
        });
      const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
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
      console.error("Failed to prepare Person image upload:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

async function loadPerson(teamId: number, personId: string) {
  const t = await getTranslations("Tagging.PersonLibrary");
  const person = await prisma.assetPerson.findFirst({
    where: {
      id: personId,
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

  if (!person) {
    throw new Error(t("processingErrors.personNotFound"));
  }

  return person;
}

async function loadPersonsByIds(teamId: number, personIds: string[]) {
  if (personIds.length === 0) {
    return [];
  }

  const persons = await prisma.assetPerson.findMany({
    where: {
      teamId,
      id: {
        in: personIds,
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

  return persons.map((ip) => normalizePerson(ip));
}

function scheduleAssetPersonProcessing(teamId: number, personId: string) {
  after(async () => {
    try {
      await processAssetPersonReferenceVectors({
        teamId,
        personId,
      });
    } catch (error) {
      console.error("Failed to process asset Person vectors:", error);
    }
  });
}

async function getClassifyFaceSchema() {
  const t = await getTranslations("Tagging.PersonClassify");
  return z.object({
    detectionIndex: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).min(1, t("errors.missingEmbedding")),
    box: z.object({
      xMin: z.number().finite(),
      yMin: z.number().finite(),
      xMax: z.number().finite(),
      yMax: z.number().finite(),
      score: z.number().finite(),
      label: z.string(),
      embedding: z.array(z.number().finite()).optional(),
      embeddingModel: z.string().optional(),
    }),
  });
}

export async function refreshAssetPersonImageSignedUrlAction(imageId: string): Promise<
  ServerActionResult<{
    imageId: string;
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
      const image = await prisma.assetPersonImage.findFirst({
        where: {
          id: imageId,
          assetPerson: {
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

      const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
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
      console.error("Failed to refresh asset Person image signed url:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

export async function fetchPersonLibraryPageData(): Promise<
  ServerActionResult<PersonLibraryPageData>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const locale = await getLocale();
      const [persons, personTypes, tags] = await Promise.all([
        fetchPersons(teamId),
        ensureDefaultPersonTypes(teamId, locale),
        fetchPersonTags(teamId),
      ]);

      return {
        success: true,
        data: {
          persons,
          personTypes: personTypes.map(normalizePersonType),
          tags,
        },
      };
    } catch (error) {
      console.error("Failed to fetch Person library data:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function exportPersonsAction(
  format: BatchFileFormat,
): Promise<ServerActionResult<PersonBatchFileResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const persons = await fetchPersons(teamId);
      const rows = buildPersonBatchExportRows({
        persons,
        columns: await getLocalizedPersonBatchColumns(),
      });
      const { buffer, mimeType } = encodeBatchFile({
        rows,
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: getBatchFileName("person-library", parsedFormat),
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to export persons:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("exportFailed"),
      };
    }
  });
}

export async function downloadPersonImportTemplateAction(
  format: BatchFileFormat = "xlsx",
): Promise<ServerActionResult<PersonBatchFileResult>> {
  return withAuth(async () => {
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;

    try {
      const parsedFormat = z.enum(["csv", "xlsx"]).parse(format);
      const columns = await getLocalizedPersonBatchColumns();
      const { buffer, mimeType } = encodeBatchFile({
        rows: buildPersonBatchTemplateRows(columns),
        format: parsedFormat,
      });

      return {
        success: true,
        data: {
          filename: `person-import-template.${parsedFormat}`,
          mimeType,
          base64: buffer.toString("base64"),
        },
      };
    } catch (error) {
      console.error("Failed to build person import template:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("templateDownloadFailed"),
      };
    }
  });
}

export async function importPersonsAction(
  formData: FormData,
): Promise<ServerActionResult<PersonBatchImportResult>> {
  return withAuth(async ({ team }) => {
    const t = getPersonBatchTranslator(
      (await getTranslations("Tagging.PersonLibrary")) as TranslationFunction,
    );
    const tBatch = (await getTranslations("Tagging.BatchImportExport")) as TranslationFunction;
    const fileErrors = getPersonBatchFileErrors(tBatch);
    const columns = await getLocalizedPersonBatchColumns();

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
      const parsedRows = parsePersonBatchRows({
        rows: tableRows,
        columns,
        fileErrors,
        listSeparator: t("listSeparator"),
        formatMissingRequiredColumns: (columnNames) =>
          tBatch("fileErrors.missingRequiredColumns", { columns: columnNames }),
      });
      const personTypes = await fetchActivePersonTypes(team.id);

      if (parsedRows.errors.length > 0) {
        return {
          success: true,
          data: {
            createdPersons: [],
            personTypes: personTypes.map(normalizePersonType),
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

      const [tagLookup, existingPersons, activePersonTypes] = await Promise.all([
        buildTagPathLookup(team.id),
        prisma.assetPerson.findMany({
          where: {
            teamId: team.id,
          },
          select: {
            name: true,
          },
        }),
        fetchActivePersonTypes(team.id),
      ]);
      const existingNames = new Set(existingPersons.map((person) => person.name));
      const personTypeCache = new Map(
        activePersonTypes.map((personType) => [personType.name.toLowerCase(), personType] as const),
      );
      const createdPersons: PersonItem[] = [];
      const failures: PersonBatchImportFailure[] = [];

      for (const row of parsedRows.records) {
        try {
          const person = await importPersonBatchRow({
            team,
            row,
            tagLookup,
            personTypeCache,
            existingNames,
            t,
          });
          createdPersons.push(person);
        } catch (error) {
          failures.push({
            rowNumber: row.rowNumber,
            name: row.name.trim() || null,
            message:
              getReferenceValidationErrorMessage(error, t) ??
              (error instanceof Error ? error.message : tBatch("rowImportFailed")),
          });
        }
      }

      const nextPersonTypes = await fetchActivePersonTypes(team.id);

      return {
        success: true,
        data: {
          createdPersons,
          personTypes: nextPersonTypes.map(normalizePersonType),
          successCount: createdPersons.length,
          failedCount: failures.length,
          skippedCount: 0,
          failures,
        },
      };
    } catch (error) {
      console.error("Failed to import persons:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : tBatch("importFailed"),
      };
    }
  });
}

export async function preparePersonClassificationAction(input: {
  objectKey: string;
  mimeType: string;
  size: number;
}): Promise<ServerActionResult<PersonClassificationUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonClassify");
      const metadata = z
        .object({
          objectKey: z.string().trim().min(1),
          mimeType: z.string().trim().min(1).max(255),
          size: z.number().int().positive().max(MAX_CLIENT_IMAGE_UPLOAD_BYTES),
        })
        .parse(input);

      if (!isTeamPersonObjectKey(metadata.objectKey, teamId)) {
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

      const { signedUrl: detectionImageUrl } = getCachedSignedS3ObjectUrl({
        objectKey: metadata.objectKey,
        expiresInSeconds: 60 * 60,
      });
      const { signedUrl, signedUrlExpiresAt } = getCachedBrowserS3ObjectUrl({
        objectKey: metadata.objectKey,
        expiresInSeconds: 60 * 60,
      });
      const imageInput = await fetchRemoteImageInput(detectionImageUrl, "person classification");
      const detection = await detectPersonFaceBoxes({
        imageBase64: imageInput.dataUrl,
        includeEmbedding: true,
      });

      return {
        success: true,
        data: {
          objectKey: metadata.objectKey,
          signedUrl,
          signedUrlExpiresAt,
          detections: detection.detections,
          faceCount: detection.faceCount,
          found: detection.found,
        },
      };
    } catch (error) {
      console.error("Failed to prepare Person classification:", error);
      const t = await getTranslations("Tagging.PersonClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("errors.processingFailed"),
      };
    }
  });
}

export async function classifyPersonImageAction(input: {
  faces: Array<{
    detectionIndex: number;
    box: PersonDetectionBox;
    embedding: number[];
  }>;
}): Promise<ServerActionResult<{ result: PersonClassificationResult }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonClassify");
      const classifyFaceSchema = await getClassifyFaceSchema();
      const faces = z.array(classifyFaceSchema).min(1, t("noFacesDetected")).parse(input.faces);

      const result = await classifyPersonFaceEmbeddings({
        teamId,
        faces,
      });

      return {
        success: true,
        data: {
          result,
        },
      };
    } catch (error) {
      console.error("Failed to classify Person image:", error);
      const t = await getTranslations("Tagging.PersonClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("classifyFailed"),
      };
    }
  });
}

export async function createAssetPersonAction(
  formData: FormData,
): Promise<ServerActionResult<{ person: PersonItem }>> {
  return withAuth(async ({ team }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
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

      const [personType, selectedTags] = await Promise.all([
        resolvePersonType(team.id, input.personTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uploadedImages = await uploadNewPersonImages({
        files,
        teamId: team.id,
      });
      const uploadedAssetLibraryImages = await uploadAssetLibraryImages({
        assets: assetLibraryDownloadUrls.map((url) => ({ downloadUrl: url })),
        teamId: team.id,
      });
      const allUploadedImages = [
        ...uploadedImages,
        ...assetLibraryUploadedImages,
        ...uploadedAssetLibraryImages,
      ];
      await validateUploadedPersonImageObjectKeys({
        images: allUploadedImages,
        teamId: team.id,
      });
      await validateSingleFaceReferenceImages(allUploadedImages);

      const createdPerson = await prisma.assetPerson.create({
        data: {
          teamId: team.id,
          name: input.name,
          personTypeId: personType.id,
          personTypeName: personType.name,
          notes: input.notes,
          status: "processing",
          processingError: null,
          enabled: true,
          images: {
            create: allUploadedImages.map((image, index) => ({
              objectKey: image.objectKey,
              mimeType: image.mimeType,
              size: image.size,
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

      const person = await loadPerson(team.id, createdPerson.id);
      scheduleAssetPersonProcessing(team.id, createdPerson.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "person",
        identifierId: person.id,
        identifierName: person.name,
        identifierTypeId: personType.id,
        identifierTypeName: personType.name,
        firstImageObjectKey: person.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          person: normalizePerson(person),
        },
      };
    } catch (error) {
      console.error("Failed to create asset Person:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message:
          getReferenceValidationErrorMessage(error, t) ??
          (error instanceof Error ? error.message : t("createFailed")),
      };
    }
  });
}

export async function updateAssetPersonAction(
  formData: FormData,
): Promise<ServerActionResult<{ person: PersonItem }>> {
  return withAuth(async ({ team }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const input = await parseCreateOrUpdateInput(formData);
      if (!input.id) {
        return {
          success: false,
          message: t("validation.missingId"),
        };
      }

      const person = await prisma.assetPerson.findFirst({
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

      if (!person) {
        return {
          success: false,
          message: t("processingErrors.personNotFound"),
        };
      }

      const files = extractSubmittedImages(formData);
      const assetLibraryDownloadUrls = Array.from(new Set(input.assetLibraryDownloadUrls));
      const assetLibraryUploadedImages = input.assetLibraryUploadedImages;
      const [personType, selectedTags] = await Promise.all([
        resolvePersonType(team.id, input.personTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uniqueExistingImageIds = Array.from(new Set(input.existingImageIds));
      const retainedImages = person.images.filter((image) =>
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

      const uploadedImages = await uploadNewPersonImages({
        files,
        teamId: team.id,
      });
      const uploadedAssetLibraryImages = await uploadAssetLibraryImages({
        assets: assetLibraryDownloadUrls.map((url) => ({ downloadUrl: url })),
        teamId: team.id,
      });
      const allUploadedImages = [
        ...uploadedImages,
        ...assetLibraryUploadedImages,
        ...uploadedAssetLibraryImages,
      ];
      const finalImages = [...retainedImages, ...allUploadedImages];
      await validateUploadedPersonImageObjectKeys({
        images: allUploadedImages,
        teamId: team.id,
      });
      await validateSingleFaceReferenceImages(finalImages);

      await prisma.$transaction(async (tx) => {
        await tx.assetPerson.update({
          where: {
            id: person.id,
          },
          data: {
            name: input.name,
            personTypeId: personType.id,
            personTypeName: personType.name,
            notes: input.notes,
            status: "processing",
            processingError: null,
            processedAt: null,
          },
        });

        await tx.assetPersonImage.deleteMany({
          where: {
            assetPersonId: person.id,
            id: {
              notIn: retainedImages.map((image) => image.id),
            },
          },
        });

        await tx.assetPersonTag.deleteMany({
          where: {
            assetPersonId: person.id,
          },
        });

        for (let index = 0; index < retainedImages.length; index += 1) {
          await tx.assetPersonImage.update({
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
          await tx.assetPersonImage.createMany({
            data: allUploadedImages.map((image, index) => ({
              assetPersonId: person.id,
              objectKey: image.objectKey,
              mimeType: image.mimeType,
              size: image.size,
              sort: retainedImages.length + index + 1,
            })),
          });
        }

        if (selectedTags.length > 0) {
          await tx.assetPersonTag.createMany({
            data: selectedTags.map((tag) => ({
              assetPersonId: person.id,
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

      await setPersonVectorPayloadByPerson({
        teamId: team.id,
        assetPersonId: person.id,
        payload: {
          enabled: person.enabled,
          status: "processing",
        },
      }).catch((error) => {
        console.warn("Failed to mark Person vectors as processing:", error);
      });

      const updatedPerson = await loadPerson(team.id, person.id);
      scheduleAssetPersonProcessing(team.id, person.id);
      schedulePushFeatureToMuseDAM({
        team,
        featureType: "person",
        identifierId: updatedPerson.id,
        identifierName: updatedPerson.name,
        identifierTypeId: personType.id,
        identifierTypeName: personType.name,
        firstImageObjectKey: updatedPerson.images[0]?.objectKey,
        internalAssetTagIds: input.tagIds,
      });

      return {
        success: true,
        data: {
          person: normalizePerson(updatedPerson),
        },
      };
    } catch (error) {
      console.error("Failed to update asset Person:", error);
      return {
        success: false,
        message:
          getReferenceValidationErrorMessage(error, t) ??
          (error instanceof Error ? error.message : t("updateFailed")),
      };
    }
  });
}

export async function setAssetPersonEnabledAction(
  personId: string,
  enabled: boolean,
): Promise<ServerActionResult<{ person: PersonItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
      const person = await prisma.assetPerson.findFirst({
        where: {
          id: personId,
          teamId,
        },
      });

      if (!person) {
        return {
          success: false,
          message: t("processingErrors.personNotFound"),
        };
      }

      await prisma.assetPerson.update({
        where: {
          id: personId,
        },
        data: {
          enabled,
        },
      });

      await setPersonVectorPayloadByPerson({
        teamId,
        assetPersonId: personId,
        payload: {
          enabled,
        },
      }).catch((error) => {
        console.warn("Failed to sync Person enabled payload to Qdrant:", error);
      });

      const updatedPerson = await loadPerson(teamId, personId);

      return {
        success: true,
        data: {
          person: normalizePerson(updatedPerson),
        },
      };
    } catch (error) {
      console.error("Failed to toggle asset Person enabled:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: t("toggleEnabledFailed"),
      };
    }
  });
}

export async function deleteAssetPersonAction(
  personId: string,
): Promise<ServerActionResult<{ personId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonLibrary");
      const person = await prisma.assetPerson.findFirst({
        where: {
          id: personId,
          teamId,
        },
      });

      if (!person) {
        return {
          success: false,
          message: t("processingErrors.personNotFound"),
        };
      }

      await prisma.assetPerson.delete({
        where: {
          id: personId,
        },
      });

      await deletePersonVectorPointsByPerson({
        teamId,
        assetPersonId: personId,
      }).catch(() => undefined);

      return {
        success: true,
        data: {
          personId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset Person:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: t("deleteFailed"),
      };
    }
  });
}

export async function retryAssetPersonProcessingAction(
  personId: string,
): Promise<ServerActionResult<{ person: PersonItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const person = await prisma.assetPerson.findFirst({
        where: {
          id: personId,
          teamId,
        },
      });

      if (!person) {
        return {
          success: false,
          message: t("processingErrors.personNotFound"),
        };
      }

      if (person.status !== "failed") {
        return {
          success: false,
          message: t("retryOnlyFailed"),
        };
      }

      await markAssetPersonVectorsProcessing({
        teamId,
        personId,
        enabled: person.enabled,
      });

      const updatedPerson = await loadPerson(teamId, personId);
      scheduleAssetPersonProcessing(teamId, personId);

      return {
        success: true,
        data: {
          person: normalizePerson(updatedPerson),
        },
      };
    } catch (error) {
      console.error("Failed to retry asset Person processing:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("retryFailed"),
      };
    }
  });
}

export async function pollPersonsAction(
  personIds: string[],
): Promise<ServerActionResult<{ persons: PersonItem[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const uniqueIds = Array.from(new Set(personIds)).filter(
        (id) => typeof id === "string" && id.length > 0,
      );
      const persons = await loadPersonsByIds(teamId, uniqueIds);

      return {
        success: true,
        data: {
          persons,
        },
      };
    } catch (error) {
      console.error("Failed to poll Persons:", error);
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function createAssetPersonTypeAction(
  name: string,
): Promise<ServerActionResult<{ personType: PersonTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const personTypeNameSchema = await getPersonTypeNameSchema();
      const parsedName = personTypeNameSchema.parse(name);

      const existingType = await prisma.assetPersonType.findFirst({
        where: {
          teamId,
          name: parsedName,
        },
      });

      if (existingType) {
        return {
          success: false,
          message: t("personType.duplicated"),
        };
      }

      const lastType = await prisma.assetPersonType.findFirst({
        where: {
          teamId,
        },
        orderBy: [{ sort: "desc" }, { id: "desc" }],
      });

      const personType = await prisma.assetPersonType.create({
        data: {
          teamId,
          name: parsedName,
          sort: (lastType?.sort ?? 0) + 1,
        },
      });

      return {
        success: true,
        data: {
          personType: normalizePersonType(personType),
        },
      };
    } catch (error) {
      console.error("Failed to create asset Person type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("createFailed"),
      };
    }
  });
}

export async function updateAssetPersonTypeAction(
  personTypeId: string,
  name: string,
): Promise<ServerActionResult<{ personType: PersonTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const personTypeNameSchema = await getPersonTypeNameSchema();
      const parsedName = personTypeNameSchema.parse(name);

      const personType = await prisma.assetPersonType.findFirst({
        where: {
          id: personTypeId,
          teamId,
        },
      });

      if (!personType) {
        return {
          success: false,
          message: t("personType.deleted"),
        };
      }

      const duplicatedType = await prisma.assetPersonType.findFirst({
        where: {
          teamId,
          name: parsedName,
          id: {
            not: personTypeId,
          },
        },
      });

      if (duplicatedType) {
        return {
          success: false,
          message: t("personType.duplicated"),
        };
      }

      const updatedType = await prisma.$transaction(async (tx) => {
        const nextType = await tx.assetPersonType.update({
          where: {
            id: personTypeId,
          },
          data: {
            name: parsedName,
          },
        });

        await tx.assetPerson.updateMany({
          where: {
            teamId,
            personTypeId,
          },
          data: {
            personTypeName: parsedName,
          },
        });

        return nextType;
      });

      return {
        success: true,
        data: {
          personType: normalizePersonType(updatedType),
        },
      };
    } catch (error) {
      console.error("Failed to update asset Person type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("personType.updated"),
      };
    }
  });
}

export async function softDeleteAssetPersonTypeAction(
  personTypeId: string,
): Promise<ServerActionResult<{ personTypeId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const personType = await prisma.assetPersonType.findFirst({
        where: {
          id: personTypeId,
          teamId,
        },
      });

      if (!personType) {
        return {
          success: false,
          message: t("personType.deleted"),
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.assetPersonType.delete({
          where: {
            id: personTypeId,
          },
        });

        const remainingTypes = await tx.assetPersonType.findMany({
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
            tx.assetPersonType.update({
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
          personTypeId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset Person type:", error);
      return {
        success: false,
        message: t("personType.deleted"),
      };
    }
  });
}

export async function reorderAssetPersonTypesAction(
  orderedIds: string[],
): Promise<ServerActionResult<{ orderedIds: string[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.PersonLibrary");
    try {
      const uniqueOrderedIds = Array.from(new Set(orderedIds));

      const activeTypes = await prisma.assetPersonType.findMany({
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
          message: t("personType.reorderFailed"),
        };
      }

      await prisma.$transaction(
        uniqueOrderedIds.map((id, index) =>
          prisma.assetPersonType.update({
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
      console.error("Failed to reorder asset Person types:", error);
      return {
        success: false,
        message: t("personType.reorderFailed"),
      };
    }
  });
}
