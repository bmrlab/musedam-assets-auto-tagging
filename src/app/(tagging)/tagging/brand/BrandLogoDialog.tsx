/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import {
  CLIENT_IMAGE_PREPARATION_ERROR_CODES,
  getClientImagePreparationErrorCode,
  prepareClientImageUpload,
} from "@/lib/brand/browser-image";
import { MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES } from "@/lib/brand/upload-constants";
import { FolderOpen, Info, Loader2, Plus, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAssetLogoAction,
  prepareAssetLibraryLogoImagesAction,
  updateAssetLogoAction,
} from "./actions";
import BrandTagSelector from "./BrandTagSelector";
import LogoTypeSelect from "./LogoTypeSelect";
import SignedBrandImage from "./SignedBrandImage";
import { BrandLogoItem, BrandLogoTypeItem, BrandTagTreeNode } from "./types";

type DraftImage = {
  id: string;
  existingImageId?: string;
  assetLibraryUploadedImage?: {
    objectKey: string;
    mimeType: string;
    size: number;
  };
  previewUrl: string;
  signedUrl?: string;
  signedUrlExpiresAt?: number;
  name: string;
  file?: File;
  shouldRevokePreviewUrl?: boolean;
};

type BrandLogoDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  logo: BrandLogoItem | null;
  logoTypes: BrandLogoTypeItem[];
  tags: BrandTagTreeNode[];
  onOpenChange: (open: boolean) => void;
  onSaved: (logo: BrandLogoItem) => void;
  onLogoTypesChange: (types: BrandLogoTypeItem[]) => void;
  onLogoTypeRenamed: (typeId: string, name: string) => void;
  onLogoTypeDeleted: (typeId: string) => void;
};

function revokeDraftImageUrls(images: DraftImage[]) {
  for (const image of images) {
    if (image.shouldRevokePreviewUrl) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

function buildDraftImages(logo: BrandLogoItem | null) {
  if (!logo) {
    return [];
  }

  return logo.images.map((image, index) => ({
    id: `existing-${image.id}`,
    existingImageId: image.id,
    previewUrl: image.signedUrl,
    signedUrl: image.signedUrl,
    signedUrlExpiresAt: image.signedUrlExpiresAt,
    name: `${logo.name} 标识图 ${index + 1}`,
    shouldRevokePreviewUrl: false,
  }));
}

export default function BrandLogoDialog({
  open,
  mode,
  logo,
  logoTypes,
  tags,
  onOpenChange,
  onSaved,
  onLogoTypesChange,
  onLogoTypeRenamed,
  onLogoTypeDeleted,
}: BrandLogoDialogProps) {
  const t = useTranslations("Tagging.BrandLibrary");
  const [name, setName] = useState("");
  const [logoTypeId, setLogoTypeId] = useState<string | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [isSelectingAssets, setIsSelectingAssets] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<DraftImage[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(logo?.name ?? "");
    setLogoTypeId(logo?.logoTypeId ?? null);
    setSelectedTagIds(
      logo?.tags.map((tag) => tag.assetTagId).filter((id): id is number => Boolean(id)) ?? [],
    );
    setNotes(logo?.notes ?? "");
    setImages((current) => {
      revokeDraftImageUrls(current);
      return buildDraftImages(logo);
    });
  }, [open, logo]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      revokeDraftImageUrls(imagesRef.current);
    };
  }, []);

  const fallbackType =
    logo?.logoTypeId && !logoTypes.some((type) => type.id === logo.logoTypeId)
      ? {
          id: logo.logoTypeId,
          name: logo.logoTypeName,
        }
      : null;

  function getUploadErrorMessage(error: unknown) {
    switch (getClientImagePreparationErrorCode(error)) {
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.fileTooLarge:
        return t("uploadErrors.fileTooLarge");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.imageLoadFailed:
        return t("uploadErrors.imageLoadFailed");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionTargetUnreachable:
        return t("uploadErrors.compressionTargetUnreachable");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed:
        return t("uploadErrors.compressionFailed");
      default:
        return error instanceof Error ? error.message : t("uploadErrors.compressionFailed");
    }
  }

  async function handleSelectImages(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (fileList.length === 0) {
      return;
    }

    const nextImages: DraftImage[] = [];

    for (const file of fileList) {
      try {
        const preparedFile = await prepareClientImageUpload(file);
        nextImages.push({
          id: `new-${crypto.randomUUID()}`,
          previewUrl: URL.createObjectURL(preparedFile),
          name: preparedFile.name,
          file: preparedFile,
          shouldRevokePreviewUrl: true,
        });
      } catch (error) {
        toast.error(getUploadErrorMessage(error));
      }
    }

    if (nextImages.length > 0) {
      setImages((current) => [...current, ...nextImages]);
    }
  }

  async function handleSelectImagesFromAssetLibrary() {
    try {
      setIsSelectingAssets(true);
      const res = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});

      if (!res) {
        return;
      }

      const assets = res.selectedAssets;
      if (!Array.isArray(assets) || assets.length === 0) {
        toast.info("未选择任何素材");
        return;
      }

      const validAssets = assets
        .map((asset) => ({
          name: asset.name,
          downloadUrl: asset.downloadUrl ?? asset.url,
        }))
        .filter((asset) => Boolean(asset.downloadUrl));

      if (validAssets.length === 0) {
        toast.error("所选素材缺少可用下载地址");
        return;
      }

      const result = await prepareAssetLibraryLogoImagesAction(
        validAssets as Array<{ name: string; downloadUrl: string }>,
      );

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      const nextImages: DraftImage[] = result.data.images.map((image) => ({
        id: `asset-library-${crypto.randomUUID()}`,
        assetLibraryUploadedImage: {
          objectKey: image.objectKey,
          mimeType: image.mimeType,
          size: image.size,
        },
        previewUrl: image.signedUrl,
        signedUrl: image.signedUrl,
        signedUrlExpiresAt: image.signedUrlExpiresAt,
        name: image.name,
        shouldRevokePreviewUrl: false,
      }));

      setImages((current) => [...current, ...nextImages]);
    } catch (error) {
      console.error("Select assets from library failed", error);
      toast.error("从素材库选择图片失败，请重试");
    } finally {
      setIsSelectingAssets(false);
    }
  }

  function removeImage(imageId: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === imageId);
      if (target?.shouldRevokePreviewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((image) => image.id !== imageId);
    });
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("请输入标识名称");
      return;
    }

    if (!logoTypeId) {
      toast.error("请选择标识类型");
      return;
    }

    if (!logoTypes.some((type) => type.id === logoTypeId)) {
      toast.error("当前类型已被删除，请重新选择一个有效类型");
      return;
    }

    if (images.length === 0) {
      toast.error("请至少上传 1 张标识图片");
      return;
    }

    const newUploadBytes = images.reduce((total, image) => total + (image.file?.size ?? 0), 0);
    if (newUploadBytes > MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES) {
      toast.error(t("uploadErrors.totalTooLarge"));
      return;
    }

    const formData = new FormData();
    if (mode === "edit" && logo) {
      formData.append("id", String(logo.id));
    }
    formData.append("name", trimmedName);
    formData.append("logoTypeId", String(logoTypeId));
    formData.append("tagIds", JSON.stringify(selectedTagIds));
    formData.append("notes", notes.trim());
    formData.append(
      "existingImageIds",
      JSON.stringify(
        images
          .map((image) => image.existingImageId)
          .filter((imageId): imageId is string => Boolean(imageId)),
      ),
    );
    formData.append(
      "assetLibraryUploadedImages",
      JSON.stringify(
        images
          .map((image) => image.assetLibraryUploadedImage)
          .filter(
            (
              value,
            ): value is {
              objectKey: string;
              mimeType: string;
              size: number;
            } => Boolean(value),
          ),
      ),
    );

    for (const image of images) {
      if (image.file) {
        formData.append("images", image.file);
      }
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createAssetLogoAction(formData)
          : await updateAssetLogoAction(formData);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      onSaved(result.data.logo);
      onOpenChange(false);
      toast.success(
        mode === "create" ? t("createProcessingSuccess") : t("updateProcessingSuccess"),
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[920px] overflow-y-auto rounded-[20px] p-6 sm:p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-[28px] leading-[36px] font-semibold text-basic-8">
            {mode === "create" ? "新建品牌标识特征" : "编辑品牌标识特征"}
          </DialogTitle>
          {/* <DialogDescription>{t("dialogProcessingDescription")}</DialogDescription> */}
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-basic-8">标识名称</label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入标识名称"
                className="h-12 rounded-[12px]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-basic-8">标识类型</label>
              <LogoTypeSelect
                value={logoTypeId}
                onChange={setLogoTypeId}
                types={logoTypes}
                onTypesChange={onLogoTypesChange}
                onTypeRenamed={onLogoTypeRenamed}
                onTypeDeleted={onLogoTypeDeleted}
                fallbackType={fallbackType}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-basic-8">标识图片</label>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.svg"
              multiple
              className="hidden"
              onChange={handleSelectImages}
            />

            <div className="flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isPending || isSelectingAssets}
                    className="flex h-[122px] w-[122px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[#c7d4ea] bg-[#f9fbff] text-basic-5 transition-colors hover:border-primary-5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="mb-2 size-6" />
                    <span className="text-sm">添加图片</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[170px] rounded-[12px] p-2">
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 size-4" />
                    本地上传
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleSelectImagesFromAssetLibrary()}>
                    <FolderOpen className="mr-2 size-4" />
                    从素材库选取
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative h-[122px] w-[122px] overflow-hidden rounded-[16px] border bg-basic-2"
                >
                  {image.existingImageId ? (
                    <SignedBrandImage
                      imageId={image.existingImageId}
                      signedUrl={image.signedUrl!}
                      signedUrlExpiresAt={image.signedUrlExpiresAt!}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-[14px] border border-[#8fb1ff] bg-[#f7fbff] px-4 py-3 text-sm leading-6 text-basic-8">
              <Info className="mt-1 size-4 shrink-0 text-[#f5b400]" />
              <p>
                建议至少上传 2-3 张标识图。为提升 AI
                识别精度，请尽量覆盖标准版（彩色）、单色版（黑/白）、横版/竖版以及反白版等常见版本，背景建议透明或纯色。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-basic-8">关联标签</label>
              <p className="text-sm text-basic-5">
                识别命中后将自动打上这些标签，可多选且支持任意层级。
              </p>
            </div>
            <BrandTagSelector
              tags={tags}
              selectedTagIds={selectedTagIds}
              onChange={setSelectedTagIds}
              collapsedUntilFocus={mode === "create"}
              dialogOpen={open}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-basic-8">
              备注信息 <span className="ml-2 text-basic-5">选填</span>
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="适用场景、特殊说明等"
              className="min-h-[120px] rounded-[12px] border-basic-4"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            取消
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                保存中
              </>
            ) : mode === "create" ? (
              "确认"
            ) : (
              "保存"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
