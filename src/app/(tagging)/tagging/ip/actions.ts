"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import {
  IpDetectionBox,
  classifyIpImageCrops,
  detectIpFigureBoxes,
} from "@/lib/ip/ip-classification";
import {
  markAssetIpVectorsProcessing,
  processAssetIpReferenceVectors,
} from "@/lib/ip/ip-processing";
import { deleteIpVectorPointsByIp, setIpVectorPayloadByIp } from "@/lib/ip/qdrant";
import { buildAssetIpObjectKey, getCachedSignedOssObjectUrl, uploadOssObject } from "@/lib/oss";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetIp, AssetIpImage, AssetIpTag, AssetIpType, AssetTag } from "@/prisma/client/index";
import prisma from "@/prisma/prisma";
import { getLocale, getTranslations } from "next-intl/server";
import { after } from "next/server";
import { z } from "zod";
import {
  IpClassificationResult,
  IpClassificationUploadResult,
  IpImageItem,
  IpItem,
  IpLibraryPageData,
  IpTagItem,
  IpTagTreeNode,
  IpTypeItem,
} from "./types";

async function getIpValidationMessages() {
  const t = await getTranslations("Tagging.IpLibrary");
  return {
    nameRequired: t("validation.nameRequired"),
    nameTooLong: t("validation.nameTooLong"),
    tagsRequired: t("validation.tagsRequired"),
    typeNameRequired: t("ipType.typeNameRequired"),
    typeNameTooLong: t("ipType.typeNameTooLong"),
  };
}

async function getCreateOrUpdateIpSchema() {
  const messages = await getIpValidationMessages();
  return z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, messages.nameRequired).max(255, messages.nameTooLong),
    ipTypeId: z.string().uuid(),
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

async function getIpTypeNameSchema() {
  const messages = await getIpValidationMessages();
  return z
    .string()
    .trim()
    .min(1, messages.typeNameRequired)
    .max(100, messages.typeNameTooLong);
}

type AssetTagWithParents = AssetTag & {
  parent: (AssetTag & { parent: AssetTag | null }) | null;
};

type AssetIpRecord = AssetIp & {
  images: AssetIpImage[];
  tags: AssetIpTag[];
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

function normalizeIpType(type: AssetIpType): IpTypeItem {
  return {
    id: type.id,
    name: type.name,
    sort: type.sort,
  };
}

function normalizeIpImage(image: AssetIpImage): IpImageItem {
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

function normalizeIpTag(tag: AssetIpTag): IpTagItem {
  return {
    id: tag.id,
    assetTagId: tag.assetTagId,
    tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
  };
}

function normalizeIp(ip: AssetIpRecord): IpItem {
  return {
    id: ip.id,
    slug: ip.slug,
    name: ip.name,
    ipTypeId: ip.ipTypeId,
    ipTypeName: ip.ipTypeName,
    description: ip.description,
    status: ip.status,
    processingError: ip.processingError,
    processedAt: ip.processedAt,
    enabled: ip.enabled,
    notes: ip.notes,
    createdAt: ip.createdAt,
    updatedAt: ip.updatedAt,
    images: ip.images
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeIpImage),
    tags: ip.tags
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(normalizeIpTag),
  };
}

function normalizeIpTagTreeNode(
  tag: AssetTag & { children?: (AssetTag & { children?: AssetTag[] })[] },
): IpTagTreeNode {
  return {
    id: tag.id,
    name: tag.name,
    level: tag.level,
    parentId: tag.parentId,
    children: (tag.children ?? []).map((child) => normalizeIpTagTreeNode(child)),
  };
}

async function fetchActiveIpTypes(teamId: number) {
  return prisma.assetIpType.findMany({
    where: {
      teamId,
    },
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
}

function getDefaultIpTypeNames(locale: string): string[] {
  const normalizedLocale = locale.toLowerCase().replace(/_/g, "-");

  const defaults: Record<string, string[]> = {
    "zh-cn": ["品牌吉祥物", "虚拟偶像", "卡通形象", "联名IP", "其他"],
    "zh-tw": ["品牌吉祥物", "虛擬偶像", "卡通形象", "聯名IP", "其他"],
    "en-us": ["Brand Mascot", "Virtual Idol", "Cartoon Character", "Co-branded IP", "Other"],
    "ja-jp": ["ブランドマスコット", "バーチャルアイドル", "カートゥーンキャラクター", "コラボIP", "その他"],
    "ko-kr": ["브랜드 마스코트", "버추얼 아이돌", "카툰 캐릭터", "콜라보 IP", "기타"],
    "fr-fr": ["Mascotte de marque", "Idole virtuelle", "Personnage de dessin animé", "IP collaboratif", "Autre"],
    "de-de": ["Markenmaskottchen", "Virtueller Idol", "Cartoon-Figur", "Co-branded IP", "Sonstiges"],
    "es-es": ["Mascota de marca", "Ídolo virtual", "Personaje de dibujos animados", "IP colaborativo", "Otros"],
    "it-it": ["Mascotte del brand", "Idolo virtuale", "Personaggio cartoon", "IP co-branded", "Altro"],
    "pt-br": ["Mascote da Marca", "Ídolo Virtual", "Personagem de Desenho Animado", "IP Colab", "Outro"],
    "ru-ru": ["Бренд-маскот", "Виртуальный идол", "Мультяшный персонаж", "Коллаборативный IP", "Другое"],
    "vi-vn": ["Mascot thương hiệu", "Idol ảo", "Nhân vật hoạt hình", "IP hợp tác", "Khác"],
    "th-th": ["มาสคอตแบรนด์", "ไอดอลเสมือน", "ตัวละครการ์ตูน", "IP ร่วม", "อื่น ๆ"],
    "id-id": ["Maskot Brand", "Idol Virtual", "Karakter Kartun", "IP Kolaborasi", "Lainnya"],
    "hi-in": ["ब्रांड मस्कॉट", "वर्चुअल आइडल", "कार्टून कैरेक्टर", "को-ब्रांडेड आईपी", "अन्य"],
    "tr-tr": ["Marka Maskotu", "Sanal İdol", "Çizgi Film Karakteri", "İşbirliği IP", "Diğer"],
    "pl-pl": ["Maskotka marki", "Wirtualny idol", "Postać z kreskówki", "IP współbrandowany", "Inne"],
  };

  return defaults[normalizedLocale] || defaults["en-us"]!;
}

async function ensureDefaultIpTypes(teamId: number, locale: string) {
  const existing = await fetchActiveIpTypes(teamId);
  if (existing.length > 0) {
    return existing;
  }

  const names = getDefaultIpTypeNames(locale);
  await prisma.assetIpType.createMany({
    data: names.map((name, index) => ({
      teamId,
      name,
      sort: index + 1,
    })),
  });

  return fetchActiveIpTypes(teamId);
}

async function fetchIpTags(teamId: number) {
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

  return tags.map((tag) => normalizeIpTagTreeNode(tag));
}

async function fetchIps(teamId: number) {
  const ips = await prisma.assetIp.findMany({
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

  return ips.map((ip) => normalizeIp(ip));
}

async function resolveIpType(teamId: number, ipTypeId: string) {
  const t = await getTranslations("Tagging.IpLibrary");
  const ipType = await prisma.assetIpType.findFirst({
    where: {
      id: ipTypeId,
      teamId,
    },
  });

  if (!ipType) {
    throw new Error(t("validation.typeDeleted"));
  }

  return ipType;
}

async function resolveSelectedTags(teamId: number, tagIds: number[]) {
  const t = await getTranslations("Tagging.IpLibrary");
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

async function uploadNewIpImages({ files, teamId }: { files: File[]; teamId: number }) {
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

    const objectKey = buildAssetIpObjectKey({
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
  const t = await getTranslations("Tagging.IpLibrary");
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
    const objectKey = buildAssetIpObjectKey({
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

async function parseCreateOrUpdateInput(formData: FormData) {
  const schema = await getCreateOrUpdateIpSchema();
  return schema.parse({
    id: (() => {
      const idValue = formData.get("id");
      if (typeof idValue !== "string" || !idValue.trim()) {
        return undefined;
      }
      return idValue;
    })(),
    name: formData.get("name"),
    ipTypeId: formData.get("ipTypeId"),
    description: typeof formData.get("description") === "string" ? formData.get("description") : "",
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

export async function prepareAssetLibraryIpImagesAction(
  assets: Array<{ name: string; downloadUrl: string }>,
): Promise<ServerActionResult<{ images: UploadedAssetLibraryImage[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpLibrary");
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
      console.error("Failed to prepare asset library IP images:", error);
      const t = await getTranslations("Tagging.IpLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("uploadErrors.selectFromLibraryFailed"),
      };
    }
  });
}

async function loadIp(teamId: number, ipId: string) {
  const t = await getTranslations("Tagging.IpLibrary");
  const ip = await prisma.assetIp.findFirst({
    where: {
      id: ipId,
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

  if (!ip) {
    throw new Error(t("processingErrors.ipNotFound"));
  }

  return ip;
}

async function loadIpsByIds(teamId: number, ipIds: string[]) {
  if (ipIds.length === 0) {
    return [];
  }

  const ips = await prisma.assetIp.findMany({
    where: {
      teamId,
      id: {
        in: ipIds,
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

  return ips.map((ip) => normalizeIp(ip));
}

function scheduleAssetIpProcessing(teamId: number, ipId: string) {
  after(async () => {
    try {
      await processAssetIpReferenceVectors({
        teamId,
        ipId,
      });
    } catch (error) {
      console.error("Failed to process asset IP vectors:", error);
    }
  });
}

async function getClassifyCropSchema() {
  const t = await getTranslations("Tagging.IpClassify");
  return z.object({
    image: z.string().min(1, t("errors.imageLoadFailed")),
    box: z.object({
      xMin: z.number().finite(),
      yMin: z.number().finite(),
      xMax: z.number().finite(),
      yMax: z.number().finite(),
      score: z.number().finite(),
      label: z.string(),
    }),
  });
}

export async function refreshAssetIpImageSignedUrlAction(imageId: string): Promise<
  ServerActionResult<{
    imageId: string;
    signedUrl: string;
    signedUrlExpiresAt: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.BrandLibrary");
      const image = await prisma.assetIpImage.findFirst({
        where: {
          id: imageId,
          assetIp: {
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
      console.error("Failed to refresh asset IP image signed url:", error);
      const t = await getTranslations("Tagging.BrandLibrary");
      return {
        success: false,
        message: t("uploadErrors.imageLoadFailed"),
      };
    }
  });
}

export async function fetchIpLibraryPageData(): Promise<ServerActionResult<IpLibraryPageData>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const locale = await getLocale();
      const [ips, ipTypes, tags] = await Promise.all([
        fetchIps(teamId),
        ensureDefaultIpTypes(teamId, locale),
        fetchIpTags(teamId),
      ]);

      return {
        success: true,
        data: {
          ips,
          ipTypes: ipTypes.map(normalizeIpType),
          tags,
        },
      };
    } catch (error) {
      console.error("Failed to fetch IP library data:", error);
      const t = await getTranslations("Tagging.IpLibrary");
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function prepareIpClassificationAction(
  formData: FormData,
): Promise<ServerActionResult<IpClassificationUploadResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpClassify");
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

      const objectKey = buildAssetIpObjectKey({
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
      const detection = await detectIpFigureBoxes({
        teamId,
        imageUrl: signedUrl,
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
      console.error("Failed to prepare IP classification:", error);
      const t = await getTranslations("Tagging.IpClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("errors.processingFailed"),
      };
    }
  });
}

export async function classifyIpImageAction(input: {
  crops: Array<{
    image: string;
    box: IpDetectionBox;
  }>;
}): Promise<ServerActionResult<{ result: IpClassificationResult }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpClassify");
      const classifyCropSchema = await getClassifyCropSchema();
      const crops = z.array(classifyCropSchema).min(1, t("uploadImageFirst")).parse(input.crops);

      const result = await classifyIpImageCrops({
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
      console.error("Failed to classify IP image:", error);
      const t = await getTranslations("Tagging.IpClassify");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("classifyFailed"),
      };
    }
  });
}

export async function createAssetIpAction(
  formData: FormData,
): Promise<ServerActionResult<{ ip: IpItem }>> {
  return withAuth(async ({ team }) => {
    try {
      const t = await getTranslations("Tagging.IpLibrary");
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

      const [ipType, selectedTags] = await Promise.all([
        resolveIpType(team.id, input.ipTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uploadedImages = await uploadNewIpImages({
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

      const createdIp = await prisma.assetIp.create({
        data: {
          teamId: team.id,
          name: input.name,
          ipTypeId: ipType.id,
          ipTypeName: ipType.name,
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

      const ip = await loadIp(team.id, createdIp.id);
      scheduleAssetIpProcessing(team.id, createdIp.id);

      return {
        success: true,
        data: {
          ip: normalizeIp(ip),
        },
      };
    } catch (error) {
      console.error("Failed to create asset IP:", error);
      const t = await getTranslations("Tagging.IpLibrary");
      return {
        success: false,
        message: error instanceof Error ? error.message : t("createFailed"),
      };
    }
  });
}

export async function updateAssetIpAction(
  formData: FormData,
): Promise<ServerActionResult<{ ip: IpItem }>> {
  return withAuth(async ({ team }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const input = await parseCreateOrUpdateInput(formData);
      if (!input.id) {
        return {
          success: false,
          message: t("validation.missingId"),
        };
      }

      const ip = await prisma.assetIp.findFirst({
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

      if (!ip) {
        return {
          success: false,
          message: t("processingErrors.ipNotFound"),
        };
      }

      const files = extractSubmittedImages(formData);
      const assetLibraryDownloadUrls = Array.from(new Set(input.assetLibraryDownloadUrls));
      const assetLibraryUploadedImages = input.assetLibraryUploadedImages;
      const [ipType, selectedTags] = await Promise.all([
        resolveIpType(team.id, input.ipTypeId),
        resolveSelectedTags(team.id, input.tagIds),
      ]);

      const uniqueExistingImageIds = Array.from(new Set(input.existingImageIds));
      const retainedImages = ip.images.filter((image) => uniqueExistingImageIds.includes(image.id));

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

      const uploadedImages = await uploadNewIpImages({
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
        await tx.assetIp.update({
          where: {
            id: ip.id,
          },
          data: {
            name: input.name,
            ipTypeId: ipType.id,
            ipTypeName: ipType.name,
            description: input.description.trim(),
            notes: input.notes,
            status: "processing",
            processingError: null,
            processedAt: null,
          },
        });

        await tx.assetIpImage.deleteMany({
          where: {
            assetIpId: ip.id,
            id: {
              notIn: retainedImages.map((image) => image.id),
            },
          },
        });

        await tx.assetIpTag.deleteMany({
          where: {
            assetIpId: ip.id,
          },
        });

        const finalImages = [...retainedImages, ...allUploadedImages];

        for (let index = 0; index < retainedImages.length; index += 1) {
          await tx.assetIpImage.update({
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
          await tx.assetIpImage.createMany({
            data: allUploadedImages.map((image, index) => ({
              assetIpId: ip.id,
              ...image,
              sort: retainedImages.length + index + 1,
            })),
          });
        }

        if (selectedTags.length > 0) {
          await tx.assetIpTag.createMany({
            data: selectedTags.map((tag) => ({
              assetIpId: ip.id,
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

      await setIpVectorPayloadByIp({
        teamId: team.id,
        assetIpId: ip.id,
        payload: {
          enabled: ip.enabled,
          status: "processing",
        },
      }).catch((error) => {
        console.warn("Failed to mark IP vectors as processing:", error);
      });

      const updatedIp = await loadIp(team.id, ip.id);
      scheduleAssetIpProcessing(team.id, ip.id);

      return {
        success: true,
        data: {
          ip: normalizeIp(updatedIp),
        },
      };
    } catch (error) {
      console.error("Failed to update asset IP:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("updateFailed"),
      };
    }
  });
}

export async function setAssetIpEnabledAction(
  ipId: string,
  enabled: boolean,
): Promise<ServerActionResult<{ ip: IpItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpLibrary");
      const ip = await prisma.assetIp.findFirst({
        where: {
          id: ipId,
          teamId,
        },
      });

      if (!ip) {
        return {
          success: false,
          message: t("processingErrors.ipNotFound"),
        };
      }

      await prisma.assetIp.update({
        where: {
          id: ipId,
        },
        data: {
          enabled,
        },
      });

      await setIpVectorPayloadByIp({
        teamId,
        assetIpId: ipId,
        payload: {
          enabled,
        },
      }).catch((error) => {
        console.warn("Failed to sync IP enabled payload to Qdrant:", error);
      });

      const updatedIp = await loadIp(teamId, ipId);

      return {
        success: true,
        data: {
          ip: normalizeIp(updatedIp),
        },
      };
    } catch (error) {
      console.error("Failed to toggle asset IP enabled:", error);
      const t = await getTranslations("Tagging.IpLibrary");
      return {
        success: false,
        message: t("toggleEnabledFailed"),
      };
    }
  });
}

export async function deleteAssetIpAction(
  ipId: string,
): Promise<ServerActionResult<{ ipId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpLibrary");
      const ip = await prisma.assetIp.findFirst({
        where: {
          id: ipId,
          teamId,
        },
      });

      if (!ip) {
        return {
          success: false,
          message: t("processingErrors.ipNotFound"),
        };
      }

      await prisma.assetIp.delete({
        where: {
          id: ipId,
        },
      });

      await deleteIpVectorPointsByIp({
        teamId,
        assetIpId: ipId,
      }).catch(() => undefined);

      return {
        success: true,
        data: {
          ipId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset IP:", error);
      const t = await getTranslations("Tagging.IpLibrary");
      return {
        success: false,
        message: t("deleteFailed"),
      };
    }
  });
}

export async function retryAssetIpProcessingAction(
  ipId: string,
): Promise<ServerActionResult<{ ip: IpItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const t = await getTranslations("Tagging.IpLibrary");
      const ip = await prisma.assetIp.findFirst({
        where: {
          id: ipId,
          teamId,
        },
      });

      if (!ip) {
        return {
          success: false,
          message: t("processingErrors.ipNotFound"),
        };
      }

      if (ip.status !== "failed") {
        return {
          success: false,
          message: t("retryOnlyFailed"),
        };
      }

      await markAssetIpVectorsProcessing({
        teamId,
        ipId,
        enabled: ip.enabled,
      });

      const updatedIp = await loadIp(teamId, ipId);
      scheduleAssetIpProcessing(teamId, ipId);

      return {
        success: true,
        data: {
          ip: normalizeIp(updatedIp),
        },
      };
    } catch (error) {
      console.error("Failed to retry asset IP processing:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("retryFailed"),
      };
    }
  });
}

export async function pollIpsAction(
  ipIds: string[],
): Promise<ServerActionResult<{ ips: IpItem[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const uniqueIds = Array.from(new Set(ipIds)).filter(
        (id) => typeof id === "string" && id.length > 0,
      );
      const ips = await loadIpsByIds(teamId, uniqueIds);

      return {
        success: true,
        data: {
          ips,
        },
      };
    } catch (error) {
      console.error("Failed to poll IPs:", error);
      return {
        success: false,
        message: t("createFailed"),
      };
    }
  });
}

export async function createAssetIpTypeAction(
  name: string,
): Promise<ServerActionResult<{ ipType: IpTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const ipTypeNameSchema = await getIpTypeNameSchema();
      const parsedName = ipTypeNameSchema.parse(name);

      const existingType = await prisma.assetIpType.findFirst({
        where: {
          teamId,
          name: parsedName,
        },
      });

      if (existingType) {
        return {
          success: false,
          message: t("ipType.duplicated"),
        };
      }

      const lastType = await prisma.assetIpType.findFirst({
        where: {
          teamId,
        },
        orderBy: [{ sort: "desc" }, { id: "desc" }],
      });

      const ipType = await prisma.assetIpType.create({
        data: {
          teamId,
          name: parsedName,
          sort: (lastType?.sort ?? 0) + 1,
        },
      });

      return {
        success: true,
        data: {
          ipType: normalizeIpType(ipType),
        },
      };
    } catch (error) {
      console.error("Failed to create asset IP type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("ipType.created"),
      };
    }
  });
}

export async function updateAssetIpTypeAction(
  ipTypeId: string,
  name: string,
): Promise<ServerActionResult<{ ipType: IpTypeItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const ipTypeNameSchema = await getIpTypeNameSchema();
      const parsedName = ipTypeNameSchema.parse(name);

      const ipType = await prisma.assetIpType.findFirst({
        where: {
          id: ipTypeId,
          teamId,
        },
      });

      if (!ipType) {
        return {
          success: false,
          message: t("ipType.deleted"),
        };
      }

      const duplicatedType = await prisma.assetIpType.findFirst({
        where: {
          teamId,
          name: parsedName,
          id: {
            not: ipTypeId,
          },
        },
      });

      if (duplicatedType) {
        return {
          success: false,
          message: t("ipType.duplicated"),
        };
      }

      const updatedType = await prisma.$transaction(async (tx) => {
        const nextType = await tx.assetIpType.update({
          where: {
            id: ipTypeId,
          },
          data: {
            name: parsedName,
          },
        });

        await tx.assetIp.updateMany({
          where: {
            teamId,
            ipTypeId,
          },
          data: {
            ipTypeName: parsedName,
          },
        });

        return nextType;
      });

      return {
        success: true,
        data: {
          ipType: normalizeIpType(updatedType),
        },
      };
    } catch (error) {
      console.error("Failed to update asset IP type:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : t("ipType.updated"),
      };
    }
  });
}

export async function softDeleteAssetIpTypeAction(
  ipTypeId: string,
): Promise<ServerActionResult<{ ipTypeId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const ipType = await prisma.assetIpType.findFirst({
        where: {
          id: ipTypeId,
          teamId,
        },
      });

      if (!ipType) {
        return {
          success: false,
          message: t("ipType.deleted"),
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.assetIpType.delete({
          where: {
            id: ipTypeId,
          },
        });

        const remainingTypes = await tx.assetIpType.findMany({
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
            tx.assetIpType.update({
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
          ipTypeId,
        },
      };
    } catch (error) {
      console.error("Failed to delete asset IP type:", error);
      return {
        success: false,
        message: t("ipType.deleted"),
      };
    }
  });
}

export async function reorderAssetIpTypesAction(
  orderedIds: string[],
): Promise<ServerActionResult<{ orderedIds: string[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const t = await getTranslations("Tagging.IpLibrary");
    try {
      const uniqueOrderedIds = Array.from(new Set(orderedIds));

      const activeTypes = await prisma.assetIpType.findMany({
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
          message: t("ipType.reorderFailed"),
        };
      }

      await prisma.$transaction(
        uniqueOrderedIds.map((id, index) =>
          prisma.assetIpType.update({
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
      console.error("Failed to reorder asset IP types:", error);
      return {
        success: false,
        message: t("ipType.reorderFailed"),
      };
    }
  });
}
