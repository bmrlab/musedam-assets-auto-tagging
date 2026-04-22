/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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
import { TagsIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import {
  CLIENT_IMAGE_PREPARATION_ERROR_CODES,
  getClientImagePreparationErrorCode,
  prepareClientImageUpload,
} from "@/lib/brand/browser-image";
import { MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES } from "@/lib/brand/upload-constants";
import { Loader2, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import BrandTagSelector from "../brand/BrandTagSelector";
import {
  createAssetIpAction,
  prepareAssetLibraryIpImagesAction,
  updateAssetIpAction,
} from "./actions";
import IpTypeSelect from "./IpTypeSelect";
import SignedIpImage from "./SignedIpImage";
import { IpItem, IpTagTreeNode, IpTypeItem } from "./types";

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

type IpDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  ip: IpItem | null;
  ipTypes: IpTypeItem[];
  usedIpTypeIds: string[];
  tags: IpTagTreeNode[];
  onOpenChange: (open: boolean) => void;
  onSaved: (ip: IpItem) => void;
  onIpTypesChange: (types: IpTypeItem[]) => void;
  onIpTypeRenamed: (typeId: string, name: string) => void;
  onIpTypeDeleted: (typeId: string) => void;
};

function getCopy(locale: string) {
  const isChinese = locale.toLowerCase().startsWith("zh");

  if (isChinese) {
    return {
      createTitle: "新建IP形象特征",
      editTitle: "编辑IP形象特征",
      nameLabel: "IP名称",
      namePlaceholder: "请输入IP名称",
      typeLabel: "IP类型",
      imageLabel: "IP图片",
      imageTip:
        "💡 图片要求：建议至少上传 3-5 张涵盖不同姿势、表情的基础造型图。如有特殊节日款或联名款造型，请统一上传至本条目内。",
      descriptionLabel: "核心特征描述",
      optional: "选填",
      descriptionHint: "请用文字描述该 IP 独有且不易改变的视觉特征",
      descriptionPlaceholder: "例如：一只红色的狐狸，戴着蓝色护目镜，脸颊有闪电标志。",
      tagsLabel: "关联标签",
      tagsHint: "识别命中后将自动打上这些标签",
      notesLabel: "备注信息",
      notesPlaceholder: "如IP来源、授权说明等",
      localUpload: "本地上传",
      assetLibraryUpload: "从素材库选取",
      uploadImage: "上传图片",
      previewImage: "查看图片",
      removeImage: "删除图片",
      cancel: "取消",
      confirm: "确认",
      save: "保存",
      saving: "保存中",
      noAssetsSelected: "未选择任何素材",
      missingAssetUrl: "所选素材缺少可用下载地址",
      selectAssetFailed: "从素材库选择图片失败，请重试",
      enterName: "请输入IP名称",
      selectType: "请选择IP类型",
      invalidType: "当前类型已被删除，请重新选择一个有效类型",
      uploadAtLeastOne: "请至少上传 1 张IP图片",
      createProcessingSuccess: "IP形象已创建，正在生成参考向量",
      updateProcessingSuccess: "IP形象已更新，正在重新生成参考向量",
    };
  }

  return {
    createTitle: "Create IP Character Feature",
    editTitle: "Edit IP Character Feature",
    nameLabel: "IP Name",
    namePlaceholder: "Enter IP name",
    typeLabel: "IP Type",
    imageLabel: "IP Images",
    imageTip:
      "💡 Image requirement: upload 3-5 reference images covering different poses and expressions when possible. If there are seasonal or co-branded variants, keep them within the same entry.",
    descriptionLabel: "Core Feature Description",
    optional: "Optional",
    descriptionHint: "Describe the distinctive visual traits of this IP that do not easily change.",
    descriptionPlaceholder:
      "Example: A red fox wearing blue goggles with a lightning mark on its cheek.",
    tagsLabel: "Related Tags",
    tagsHint: "These tags will be applied automatically when a match is found",
    notesLabel: "Notes",
    notesPlaceholder: "For example: origin, licensing notes, etc.",
    localUpload: "Upload from device",
    assetLibraryUpload: "Select from asset library",
    uploadImage: "Upload images",
    previewImage: "Preview image",
    removeImage: "Remove image",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    saving: "Saving",
    noAssetsSelected: "No assets selected",
    missingAssetUrl: "The selected assets do not contain a usable download URL",
    selectAssetFailed: "Failed to select images from the asset library. Please try again.",
    enterName: "Please enter the IP name",
    selectType: "Please select an IP type",
    invalidType: "The selected type was removed. Please choose a valid one.",
    uploadAtLeastOne: "Please upload at least one IP image",
    createProcessingSuccess: "IP character created. Vector generation has started.",
    updateProcessingSuccess: "IP character updated. Vector regeneration has started.",
  };
}

function revokeDraftImageUrls(images: DraftImage[]) {
  for (const image of images) {
    if (image.shouldRevokePreviewUrl) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

function buildDraftImages(ip: IpItem | null) {
  if (!ip) {
    return [];
  }

  return ip.images.map((image, index) => ({
    id: `existing-${image.id}`,
    existingImageId: image.id,
    previewUrl: image.signedUrl,
    signedUrl: image.signedUrl,
    signedUrlExpiresAt: image.signedUrlExpiresAt,
    name: `${ip.name} IP 图 ${index + 1}`,
    shouldRevokePreviewUrl: false,
  }));
}

export default function IpDialog({
  open,
  mode,
  ip,
  ipTypes,
  usedIpTypeIds,
  tags,
  onOpenChange,
  onSaved,
  onIpTypesChange,
  onIpTypeRenamed,
  onIpTypeDeleted,
}: IpDialogProps) {
  const locale = useLocale();
  const copy = getCopy(locale);
  const t = useTranslations("Tagging.BrandLibrary");
  const [name, setName] = useState("");
  const [ipTypeId, setIpTypeId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
  const [isSelectingAssets, setIsSelectingAssets] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<DraftImage[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(ip?.name ?? "");
    setIpTypeId(ip?.ipTypeId ?? null);
    setDescription(ip?.description ?? "");
    setSelectedTagIds(
      ip?.tags.map((tag) => tag.assetTagId).filter((id): id is number => Boolean(id)) ?? [],
    );
    setNotes(ip?.notes ?? "");
    setImages((current) => {
      revokeDraftImageUrls(current);
      return buildDraftImages(ip);
    });
  }, [open, ip]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      revokeDraftImageUrls(imagesRef.current);
    };
  }, []);

  const fallbackType =
    ip?.ipTypeId && !ipTypes.some((type) => type.id === ip.ipTypeId)
      ? {
          id: ip.ipTypeId,
          name: ip.ipTypeName,
        }
      : null;
  const trimmedName = name.trim();
  const hasValidIpType = Boolean(ipTypeId) && ipTypes.some((type) => type.id === ipTypeId);
  const hasImages = images.length > 0;
  const hasSelectedTags = selectedTagIds.length > 0;
  const isSubmitDisabled =
    isPending || !trimmedName || !hasValidIpType || !hasImages || !hasSelectedTags;

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
        toast.info(copy.noAssetsSelected);
        return;
      }

      const validAssets = assets
        .map((asset) => ({
          name: asset.name,
          downloadUrl: asset.downloadUrl ?? asset.url,
        }))
        .filter((asset) => Boolean(asset.downloadUrl));

      if (validAssets.length === 0) {
        toast.error(copy.missingAssetUrl);
        return;
      }

      const result = await prepareAssetLibraryIpImagesAction(
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
      toast.error(copy.selectAssetFailed);
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
    if (!trimmedName) {
      toast.error(copy.enterName);
      return;
    }

    if (!ipTypeId) {
      toast.error(copy.selectType);
      return;
    }

    if (!ipTypes.some((type) => type.id === ipTypeId)) {
      toast.error(copy.invalidType);
      return;
    }

    if (images.length === 0) {
      toast.error(copy.uploadAtLeastOne);
      return;
    }

    const newUploadBytes = images.reduce((total, image) => total + (image.file?.size ?? 0), 0);
    if (newUploadBytes > MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES) {
      toast.error(t("uploadErrors.totalTooLarge"));
      return;
    }

    const formData = new FormData();
    if (mode === "edit" && ip) {
      formData.append("id", String(ip.id));
    }
    formData.append("name", trimmedName);
    formData.append("ipTypeId", String(ipTypeId));
    formData.append("description", description.trim());
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
          ? await createAssetIpAction(formData)
          : await updateAssetIpAction(formData);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      onSaved(result.data.ip);
      onOpenChange(false);
      toast.success(
        mode === "create" ? copy.createProcessingSuccess : copy.updateProcessingSuccess,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[750px] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-[20px] p-0">
        <DialogHeader className="h-14 justify-center gap-0 px-5 py-4">
          <DialogTitle className="text-[16px] leading-6 font-semibold text-[#151A30]">
            {mode === "create" ? copy.createTitle : copy.editTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 pt-0 pb-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {copy.nameLabel}
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.namePlaceholder}
                className="h-8 w-[349px] rounded-[6px] border border-[#C5CEE0] px-3 py-0 text-[14px] leading-[22px] font-normal placeholder:text-[14px] placeholder:leading-[22px] placeholder:font-normal placeholder:text-[#8F9BB3]"
              />
            </div>

            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {copy.typeLabel}
              </label>
              <IpTypeSelect
                value={ipTypeId}
                onChange={setIpTypeId}
                types={ipTypes}
                usedTypeIds={usedIpTypeIds}
                onTypesChange={onIpTypesChange}
                onTypeRenamed={onIpTypeRenamed}
                onTypeDeleted={onIpTypeDeleted}
                fallbackType={fallbackType}
                disabled={isPending}
                triggerClassName="h-8 w-[349px] rounded-[6px] border border-[#C5CEE0] px-3 py-0 text-[14px] leading-[22px] font-normal"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {copy.imageLabel}
              </label>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.svg"
              multiple
              className="hidden"
              onChange={handleSelectImages}
            />

            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={isPending || isSelectingAssets}
                    className="relative flex h-[104px] w-[104px] flex-col items-center justify-center rounded-[6px] border border-[#C5CEE0] border-dashed bg-[#F7F9FC] px-2 py-10 text-[#2E3A59] transition-colors hover:border-primary-5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <Plus className="h-[14px] w-[14px]" />
                      <span className="text-[14px] leading-[22px] font-normal">
                        {copy.uploadImage}
                      </span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="flex w-[160px] flex-col gap-[2px] rounded-[8px] border border-[#E4E9F2] p-1"
                >
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-[#192038] hover:bg-[#F2F6FF] focus:bg-[#F2F6FF] data-[highlighted]:bg-[#F2F6FF]"
                  >
                    <img src="/Icon/export.svg" alt="" className="h-[14px] w-[14px]" />
                    <span>{copy.localUpload}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleSelectImagesFromAssetLibrary()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-[#192038] hover:bg-[#F2F6FF] focus:bg-[#F2F6FF] data-[highlighted]:bg-[#F2F6FF]"
                  >
                    <img src="/Icon/Image.svg" alt="" className="h-[14px] w-[14px]" />
                    <span>{copy.assetLibraryUpload}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative h-[104px] w-[104px] cursor-pointer overflow-hidden rounded-[6px] border border-[#C5CEE0] bg-[#F7F9FC]"
                >
                  {image.existingImageId ? (
                    <SignedIpImage
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
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={copy.previewImage}
                        onClick={() => setPreviewImage(image)}
                        className="inline-flex h-4 w-4 items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                      >
                        <img src="/Icon/View.svg" alt="" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={copy.removeImage}
                        onClick={() => removeImage(image.id)}
                        className="inline-flex h-4 w-4 items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                      >
                        <img src="/Icon/Delete.svg" alt="" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-start gap-[10px] rounded-[8px] border border-[#598BFF] bg-[#F2F6FF] px-3 py-[14px] text-[12px] leading-[16px] font-normal text-[#192038]">
              <p className="text-[12px] leading-[16px] font-normal text-[#192038]">
                {copy.imageTip}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {copy.descriptionLabel}
                <span className="ml-2 text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                  {copy.optional}
                </span>
              </label>
              <p className="text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                {copy.descriptionHint}
              </p>
            </div>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy.descriptionPlaceholder}
              className="h-[92px] rounded-[6px] border border-[#C5CEE0] px-4 py-2"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {copy.tagsLabel}
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                  {copy.tagsHint}
                </p>
              <button
                type="button"
                onClick={() =>
                  dispatchMuseDAMClientAction("goto", {
                    url: "/home/dashboard/tag",
                    target: "_blank",
                  })
                }
                className="inline-flex items-center gap-1 text-[12px] leading-[16px] font-normal text-[#3366FF] transition-opacity hover:opacity-80"
              >
                <TagsIcon />
                管理标签体系
              </button>
              </div>
            </div>
            <BrandTagSelector
              tags={tags}
              selectedTagIds={selectedTagIds}
              onChange={setSelectedTagIds}
              collapsedUntilFocus={mode === "create"}
              dialogOpen={open}
            />
          </div>

          <div className="mt-4 space-y-2">
            <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
              {copy.notesLabel}
              <span className="ml-2 text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                {copy.optional}
              </span>
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={copy.notesPlaceholder}
              className="h-[60px] rounded-[6px] border border-[#C5CEE0] px-4 py-2"
            />
          </div>
        </div>

        <DialogFooter className="min-h-16 gap-[10px] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-8 w-20 rounded-[6px] border border-[#C5CEE0] px-3 py-1"
          >
            {copy.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="h-8 w-20 rounded-[6px] border border-[#C5CEE0] px-3 py-1"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {copy.saving}
              </>
            ) : mode === "create" ? (
              copy.confirm
            ) : (
              copy.save
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(nextOpen) => !nextOpen && setPreviewImage(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-auto max-h-[90vh] max-w-[90vw] overflow-visible border-none bg-transparent p-0 shadow-none"
        >
          <DialogTitle className="sr-only">
            {previewImage ? `${previewImage.name} preview` : "Image preview"}
          </DialogTitle>
          {previewImage ? (
            <div className="relative inline-flex">
              <DialogClose className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/75">
                <X className="size-4" />
                <span className="sr-only">Close preview</span>
              </DialogClose>
              <img
                src={previewImage.previewUrl}
                alt={previewImage.name}
                className="block max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
