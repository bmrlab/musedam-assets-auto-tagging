"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import {
  PersonDetectionBox,
  classifyPersonFaceEmbeddings,
  detectPersonFaceBoxes,
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
import { buildAssetPersonObjectKey, getCachedSignedOssObjectUrl, uploadOssObject } from "@/lib/oss";
import { ServerActionResult } from "@/lib/serverAction";
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
  PersonClassificationResult,
  PersonClassificationUploadResult,
  PersonImageItem,
  PersonItem,
  PersonLibraryPageData,
  PersonTagItem,
  PersonTagTreeNode,
  PersonTypeItem,
} from "./types";

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
  return z
    .string()
    .trim()
    .min(1, messages.typeNameRequired)
    .max(100, messages.typeNameTooLong);
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
    const uploadResult = await uploadOssObject({
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

    const uploadResult = await uploadOssObject({
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

type UploadedAssetLibraryImage = {
  name: string;
  objectKey: string;
  mimeType: string;
  size: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type UploadedPersonImage = {
  objectKey: string;
  mimeType: string;
  size: number;
  name?: string;
};

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

function getReferenceValidationErrorMessage(
  error: unknown,
  t: unknown,
) {
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
          const { signedUrl, signedUrlExpiresAt } = getCachedSignedOssObjectUrl({
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
      console.error("Failed to refresh asset Person image signed url:", error);
      const t = await getTranslations("Tagging.PersonLibrary");
      return {
        success: false,
        message: t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

export async function fetchPersonLibraryPageData(): Promise<ServerActionResult<PersonLibraryPageData>> {
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

export async function preparePersonClassificationAction(
  formData: FormData,
): Promise<ServerActionResult<PersonClassificationUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.PersonClassify");
      const image = formData.get("image");
      if (!(image instanceof File) || image.size <= 0) {
        return {
          success: false,
          message: t("uploadImageFirst"),
        };
      }

      if (!isImageFile(image)) {
        return {
          success: false,
          message: t("errors.imageLoadFailed"),
        };
      }

      const objectKey = buildAssetPersonObjectKey({
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
      const detection = await detectPersonFaceBoxes({
        imageUrl: signedUrl,
        includeEmbedding: true,
      });

      return {
        success: true,
        data: {
          objectKey,
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
