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
  usedLogoTypeIds: string[];
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

function buildDraftImages(logo: BrandLogoItem | null, t: ReturnType<typeof useTranslations>) {
  if (!logo) {
    return [];
  }

  return logo.images.map((image, index) => ({
    id: `existing-${image.id}`,
    existingImageId: image.id,
    previewUrl: image.signedUrl,
    signedUrl: image.signedUrl,
    signedUrlExpiresAt: image.signedUrlExpiresAt,
    name: t("imageAltIndex", { name: logo.name, index: index + 1 }),
    shouldRevokePreviewUrl: false,
  }));
}

export default function BrandLogoDialog({
  open,
  mode,
  logo,
  logoTypes,
  usedLogoTypeIds,
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
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
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
      return buildDraftImages(logo, t);
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
  const trimmedName = name.trim();
  const hasValidLogoType = Boolean(logoTypeId) && logoTypes.some((type) => type.id === logoTypeId);
  const hasImages = images.length > 0;
  const hasSelectedTags = selectedTagIds.length > 0;
  const isSubmitDisabled =
    isPending || !trimmedName || !hasValidLogoType || !hasImages || !hasSelectedTags;

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
        toast.info(t("uploadErrors.noAssetsSelected"));
        return;
      }

      const validAssets = assets
        .map((asset) => ({
          name: asset.name,
          downloadUrl: asset.downloadUrl ?? asset.url,
        }))
        .filter((asset) => Boolean(asset.downloadUrl));

      if (validAssets.length === 0) {
        toast.error(t("uploadErrors.invalidAssets"));
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
      toast.error(t("uploadErrors.selectFromLibraryFailed"));
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
      toast.error(t("validation.nameRequired"));
      return;
    }

    if (!logoTypeId) {
      toast.error(t("validation.typeRequired"));
      return;
    }

    if (!logoTypes.some((type) => type.id === logoTypeId)) {
      toast.error(t("validation.typeDeleted"));
      return;
    }

    if (images.length === 0) {
      toast.error(t("validation.imagesRequired"));
      return;
    }

    const newUploadBytes = images.reduce((total, image) => total + (image.file?.size ?? 0), 0);
    if (newUploadBytes > MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES) {
      toast.error(t("validation.totalTooLarge"));
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
      <DialogContent className="max-h-[90vh] w-[750px] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-[20px] p-0">
        <DialogHeader className="h-14 justify-center gap-0 px-5 py-4">
          <DialogTitle className="text-[16px] leading-6 font-semibold text-[#151A30]">
            {mode === "create" ? t("dialog.titleCreate") : t("dialog.titleEdit")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 pt-0 pb-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {t("dialog.logoNameLabel")}
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("dialog.logoNamePlaceholder")}
                className="h-8 w-[349px] rounded-[6px] border border-[#C5CEE0] px-3 py-0 text-[14px] leading-[22px] font-normal placeholder:text-[14px] placeholder:leading-[22px] placeholder:font-normal placeholder:text-[#8F9BB3]"
              />
            </div>

            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {t("dialog.logoTypeLabel")}
              </label>
              <LogoTypeSelect
                value={logoTypeId}
                onChange={setLogoTypeId}
                types={logoTypes}
                usedTypeIds={usedLogoTypeIds}
                onTypesChange={onLogoTypesChange}
                onTypeRenamed={onLogoTypeRenamed}
                onTypeDeleted={onLogoTypeDeleted}
                fallbackType={fallbackType}
                disabled={isPending}
                triggerClassName="h-8 w-[349px] rounded-[6px] border border-[#C5CEE0] px-3 py-0 text-[14px] leading-[22px] font-normal"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {t("dialog.logoImagesLabel")}
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
                      <span className="text-[14px] leading-[22px] font-normal">{t("dialog.uploadImage")}</span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="flex w-[140px] flex-col gap-[2px] rounded-[8px] border border-[#E4E9F2] p-1"
                >
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-[#192038] hover:bg-[#F2F6FF] focus:bg-[#F2F6FF] data-[highlighted]:bg-[#F2F6FF]"
                  >
                    <img src="/Icon/export.svg" alt="" className="h-[14px] w-[14px]" />
                    <span>{t("dialog.uploadLocal")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleSelectImagesFromAssetLibrary()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-[#192038] hover:bg-[#F2F6FF] focus:bg-[#F2F6FF] data-[highlighted]:bg-[#F2F6FF]"
                  >
                    <img src="/Icon/Image.svg" alt="" className="h-[14px] w-[14px]" />
                    <span>{t("dialog.uploadFromLibrary")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative h-[104px] w-[104px] cursor-pointer overflow-hidden rounded-[6px] border border-[#C5CEE0] bg-[#F7F9FC]"
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
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={t("dialog.previewImage")}
                        onClick={() => setPreviewImage(image)}
                        className="inline-flex h-4 w-4 items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                      >
                        <img src="/Icon/View.svg" alt="" className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("delete")}
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
                {t("dialog.uploadHint")}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-[#222B45]">
                {t("dialog.linkedTagsLabel")}
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                  {t("dialog.linkedTagsHint")}
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
                {t("dialog.manageTags")}
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
              {t("dialog.notesLabel")}{" "}
              <span className="ml-2 text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                {t("dialog.notesOptional")}
              </span>
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("dialog.notesPlaceholder")}
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
            {t("dialog.cancel")}
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
                {t("dialog.saving")}
              </>
            ) : mode === "create" ? (
              t("dialog.confirm")
            ) : (
              t("dialog.save")
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
            {previewImage ? `${previewImage.name} ${t("dialog.previewImage")}` : t("dialog.previewImage")}
          </DialogTitle>
          {previewImage ? (
            <div className="relative inline-flex">
              <DialogClose className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/75">
                <X className="size-4" />
                <span className="sr-only">{t("dialog.closePreview")}</span>
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
