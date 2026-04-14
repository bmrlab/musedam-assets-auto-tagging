"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import {
  BrandDetectionBox,
  classifyBrandImageCrops,
  detectBrandLogoBoxes,
} from "@/lib/brand/logo-classification";
import {
  markAssetLogoVectorsProcessing,
  processAssetLogoReferenceVectors,
} from "@/lib/brand/logo-processing";
import { deleteLogoVectorPointsByLogo, setLogoVectorPayloadByLogo } from "@/lib/brand/qdrant";
import { buildAssetLogoObjectKey, getCachedSignedOssObjectUrl, uploadOssObject } from "@/lib/oss";
import { ServerActionResult } from "@/lib/serverAction";
import {
  AssetLogo,
  AssetLogoImage,
  AssetLogoTag,
  AssetLogoType,
  AssetTag,
} from "@/prisma/client/index";
import prisma from "@/prisma/prisma";
import { getTranslations } from "next-intl/server";
import { after } from "next/server";
import { z } from "zod";
import {
  BrandClassificationResult,
  BrandClassificationUploadResult,
  BrandLibraryPageData,
  BrandLogoImageItem,
  BrandLogoItem,
  BrandLogoTagItem,
  BrandLogoTypeItem,
  BrandTagTreeNode,
} from "./types";

const createOrUpdateLogoSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "请输入标识名称").max(255, "标识名称不能超过 255 个字符"),
  logoTypeId: z.string().uuid(),
  tagIds: z.array(z.number().int().positive()).min(1, "请至少选择 1 个关联标签").max(100),
  notes: z.string().max(5000).default(""),
  existingImageIds: z.array(z.string().uuid()).max(100).default([]),
});

const logoTypeNameSchema = z
  .string()
  .trim()
  .min(1, "请输入类型名称")
  .max(100, "类型名称不能超过 100 个字符");

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

const DEFAULT_LOGO_DETECTION_PROMPT = "logo . brand logo . emblem . trademark . label";

function buildLogoDetectionPromptName(name: string, logoTypeName: string) {
  const trimmedName = name.trim();
  const trimmedTypeName = logoTypeName.trim();
  return trimmedName;
}

async function fetchLogoDetectionPromptNames(teamId: number) {
  const logos = await prisma.assetLogo.findMany({
    where: {
      teamId,
      enabled: true,
      status: "completed",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      name: true,
      logoTypeName: true,
    },
  });

  const promptNames = Array.from(
    new Set(
      logos
        .map((logo) => buildLogoDetectionPromptName(logo.name, logo.logoTypeName))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );

  return [DEFAULT_LOGO_DETECTION_PROMPT, ...promptNames].join(" . ");
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
      const [logos, logoTypes, tags] = await Promise.all([
        fetchBrandLogos(teamId),
        fetchActiveLogoTypes(teamId),
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

export async function createAssetLogoAction(
  formData: FormData,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team }) => {
    try {
      const input = parseCreateOrUpdateInput(formData);
      const files = extractSubmittedImages(formData);

      if (files.length === 0) {
        return {
          success: false,
          message: "请至少上传 1 张标识图片",
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
            create: uploadedImages.map((image, index) => ({
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
        message: error instanceof Error ? error.message : "创建品牌标识失败",
      };
    }
  });
}

export async function updateAssetLogoAction(
  formData: FormData,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team }) => {
    try {
      const input = parseCreateOrUpdateInput(formData);
      if (!input.id) {
        return {
          success: false,
          message: "缺少品牌标识 ID",
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
          message: "品牌标识不存在或已被删除",
        };
      }

      const files = extractSubmittedImages(formData);
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
          message: "图片列表已过期，请刷新后重试",
        };
      }

      if (retainedImages.length + files.length === 0) {
        return {
          success: false,
          message: "请至少保留 1 张标识图片",
        };
      }

      const uploadedImages = await uploadNewLogoImages({
        files,
        teamId: team.id,
      });

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

        const finalImages = [...retainedImages, ...uploadedImages];

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

        if (uploadedImages.length > 0) {
          await tx.assetLogoImage.createMany({
            data: uploadedImages.map((image, index) => ({
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
        message: error instanceof Error ? error.message : "更新品牌标识失败",
      };
    }
  });
}

export async function setAssetLogoEnabledAction(
  logoId: string,
  enabled: boolean,
): Promise<ServerActionResult<{ logo: BrandLogoItem }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
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
          message: "品牌标识不存在或已被删除",
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
        message: "更新启用状态失败",
      };
    }
  });
}

export async function deleteAssetLogoAction(
  logoId: string,
): Promise<ServerActionResult<{ logoId: string }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
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
          message: "品牌标识不存在或已被删除",
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
        message: "删除品牌标识失败",
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
      const detectionLabelText = await fetchLogoDetectionPromptNames(teamId);
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
