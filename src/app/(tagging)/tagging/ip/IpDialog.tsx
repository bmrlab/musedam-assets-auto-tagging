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
import {
  AssetIpMatchPattern,
  DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
  IpPartialMatchPatternName,
  isIpPartialMatchPatternName,
} from "@/lib/ip/match-pattern";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  BoxSelect,
  ImageIcon,
  Loader2,
  Plus,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import BrandTagSelector from "../brand/BrandTagSelector";
import {
  createAssetIpAction,
  detectAssetIpPartialFeatureAction,
  prepareAssetLibraryIpImagesAction,
  preparePartialAssetIpImageAction,
  updateAssetIpAction,
} from "./actions";
import IpPartialFeatureCropDialog, {
  PartialFeatureCropDialogImage,
  PartialFeatureCropSelection,
} from "./IpPartialFeatureCropDialog";
import IpTypeSelect from "./IpTypeSelect";
import SignedIpImage from "./SignedIpImage";
import { IpDetectionBox, IpImageItem, IpItem, IpTagTreeNode, IpTypeItem } from "./types";

type DraftImage = {
  id: string;
  existingImageId?: string;
  objectKey?: string;
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
  partialMatchPatternName?: IpPartialMatchPatternName;
  imageWidth?: number;
  imageHeight?: number;
  detections?: IpDetectionBox[];
  cropSelection?: PartialFeatureCropSelection | null;
};

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

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

function revokeDraftImageUrls(images: DraftImage[]) {
  for (const image of images) {
    if (image.shouldRevokePreviewUrl) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

function buildCropSelectionFromImage(image: IpImageItem): PartialFeatureCropSelection | null {
  if (
    !image.partialMatchPatternName ||
    !isIpPartialMatchPatternName(image.partialMatchPatternName) ||
    typeof image.cropXMin !== "number" ||
    typeof image.cropYMin !== "number" ||
    typeof image.cropXMax !== "number" ||
    typeof image.cropYMax !== "number" ||
    typeof image.cropImageWidth !== "number" ||
    typeof image.cropImageHeight !== "number"
  ) {
    return null;
  }

  return {
    partialMatchPatternName: image.partialMatchPatternName,
    cropXMin: image.cropXMin,
    cropYMin: image.cropYMin,
    cropXMax: image.cropXMax,
    cropYMax: image.cropYMax,
    cropImageWidth: image.cropImageWidth,
    cropImageHeight: image.cropImageHeight,
    cropSource: image.cropSource === "manual" ? "manual" : "algorithm",
    cropDetectionLabel: image.cropDetectionLabel,
    cropDetectionScore: image.cropDetectionScore,
  };
}

function buildDraftImages(ip: IpItem | null, t: TranslationFunction) {
  if (!ip) {
    return [];
  }

  return ip.images.map((image, index) => {
    const rawPartialMatchPatternName = image.partialMatchPatternName ?? "";
    const partialMatchPatternName = isIpPartialMatchPatternName(rawPartialMatchPatternName)
      ? rawPartialMatchPatternName
      : DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME;

    return {
      id: `existing-${image.id}`,
      existingImageId: image.id,
      objectKey: image.objectKey,
      previewUrl: image.signedUrl,
      signedUrl: image.signedUrl,
      signedUrlExpiresAt: image.signedUrlExpiresAt,
      name: t("imageAltIndex", { name: ip.name, index: index + 1 }),
      shouldRevokePreviewUrl: false,
      partialMatchPatternName,
      imageWidth: image.cropImageWidth ?? undefined,
      imageHeight: image.cropImageHeight ?? undefined,
      cropSelection: buildCropSelectionFromImage(image),
    };
  });
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
  const t = useTranslations("Tagging.IpLibrary") as TranslationFunction;
  const tBrand = useTranslations("Tagging.BrandLibrary") as TranslationFunction;
  const [name, setName] = useState("");
  const [ipTypeId, setIpTypeId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [matchPattern, setMatchPattern] = useState<AssetIpMatchPattern>("whole");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
  const [cropImageId, setCropImageId] = useState<string | null>(null);
  const [isPreparingCrop, setIsPreparingCrop] = useState(false);
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
    setMatchPattern(ip?.matchPattern ?? "whole");
    setSelectedTagIds(
      ip?.tags.map((tag) => tag.assetTagId).filter((id): id is number => Boolean(id)) ?? [],
    );
    setNotes(ip?.notes ?? "");
    setImages((current) => {
      revokeDraftImageUrls(current);
      return buildDraftImages(ip, t);
    });
  }, [open, ip, t]);

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
  const pendingPartialCropImages = images.filter((image) => !image.cropSelection);
  const pendingPartialCropCount = matchPattern === "partial" ? pendingPartialCropImages.length : 0;
  const isSubmitDisabled =
    isPending ||
    isPreparingCrop ||
    !trimmedName ||
    !hasValidIpType ||
    !hasImages ||
    !hasSelectedTags ||
    pendingPartialCropCount > 0;

  function getUploadErrorMessage(error: unknown) {
    switch (getClientImagePreparationErrorCode(error)) {
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.fileTooLarge:
        return tBrand("uploadErrors.fileTooLarge");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.imageLoadFailed:
        return tBrand("uploadErrors.imageLoadFailed");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionTargetUnreachable:
        return tBrand("uploadErrors.compressionTargetUnreachable");
      case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed:
        return tBrand("uploadErrors.compressionFailed");
      default:
        return error instanceof Error ? error.message : tBrand("uploadErrors.compressionFailed");
    }
  }

  function patchDraftImage(imageId: string, patch: Partial<DraftImage>) {
    setImages((current) => {
      const next = current.map((image) =>
        image.id === imageId
          ? {
              ...image,
              ...patch,
            }
          : image,
      );
      imagesRef.current = next;
      return next;
    });
  }

  async function prepareImageForPartialCrop(
    image: DraftImage,
    partialMatchPatternName: IpPartialMatchPatternName,
  ) {
    if (image.assetLibraryUploadedImage?.objectKey || image.existingImageId) {
      const objectKey = image.assetLibraryUploadedImage?.objectKey ?? image.objectKey;
      if (!objectKey) {
        throw new Error(t("uploadErrors.imageLoadFailed"));
      }

      const result = await detectAssetIpPartialFeatureAction({
        objectKey,
        partialMatchPatternName,
      });

      if (!result.success) {
        throw new Error(result.message);
      }

      return {
        partialMatchPatternName,
        previewUrl: image.shouldRevokePreviewUrl ? image.previewUrl : result.data.signedUrl,
        signedUrl: result.data.signedUrl,
        signedUrlExpiresAt: result.data.signedUrlExpiresAt,
        imageWidth: result.data.imageWidth,
        imageHeight: result.data.imageHeight,
        detections: result.data.detections,
      } satisfies Partial<DraftImage>;
    }

    if (!image.file) {
      throw new Error(t("uploadErrors.imageLoadFailed"));
    }

    const formData = new FormData();
    formData.append("image", image.file);
    formData.append("partialMatchPatternName", partialMatchPatternName);

    const result = await preparePartialAssetIpImageAction(formData);
    if (!result.success) {
      throw new Error(result.message);
    }

    return {
      partialMatchPatternName,
      file: undefined,
      assetLibraryUploadedImage: {
        objectKey: result.data.objectKey,
        mimeType: result.data.mimeType,
        size: result.data.size,
      },
      objectKey: result.data.objectKey,
      signedUrl: result.data.signedUrl,
      signedUrlExpiresAt: result.data.signedUrlExpiresAt,
      imageWidth: result.data.imageWidth,
      imageHeight: result.data.imageHeight,
      detections: result.data.detections,
    } satisfies Partial<DraftImage>;
  }

  async function openPartialCropDialog(imageId: string, featureName?: IpPartialMatchPatternName) {
    const target = imagesRef.current.find((image) => image.id === imageId);
    if (!target) {
      return;
    }

    const partialMatchPatternName =
      featureName ?? target.partialMatchPatternName ?? DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME;

    setIsPreparingCrop(true);
    try {
      const patch = await prepareImageForPartialCrop(target, partialMatchPatternName);
      patchDraftImage(imageId, {
        ...patch,
        cropSelection:
          featureName && featureName !== target.cropSelection?.partialMatchPatternName
            ? null
            : target.cropSelection,
      });
      setCropImageId(imageId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("uploadErrors.imageLoadFailed"));
    } finally {
      setIsPreparingCrop(false);
    }
  }

  async function handleCropFeatureChange(featureName: IpPartialMatchPatternName) {
    if (!cropImageId) {
      return;
    }

    await openPartialCropDialog(cropImageId, featureName);
  }

  function handleConfirmPartialCrop(selection: PartialFeatureCropSelection) {
    if (!cropImageId) {
      return;
    }

    const nextImages = imagesRef.current.map((image) =>
      image.id === cropImageId
        ? {
            ...image,
            partialMatchPatternName: selection.partialMatchPatternName,
            cropSelection: selection,
          }
        : image,
    );
    const nextPending = nextImages.find((image) => !image.cropSelection);

    imagesRef.current = nextImages;
    setImages(nextImages);
    setCropImageId(null);

    if (matchPattern === "partial" && nextPending) {
      window.setTimeout(() => {
        void openPartialCropDialog(nextPending.id);
      }, 0);
    }
  }

  function handleCropDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setCropImageId(null);
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
          partialMatchPatternName: DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
          shouldRevokePreviewUrl: true,
        });
      } catch (error) {
        toast.error(getUploadErrorMessage(error));
      }
    }

    if (nextImages.length > 0) {
      setImages((current) => {
        const next = [...current, ...nextImages];
        imagesRef.current = next;
        return next;
      });
      if (matchPattern === "partial") {
        void openPartialCropDialog(nextImages[0].id);
      }
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
        toast.info(tBrand("uploadErrors.noAssetsSelected"));
        return;
      }

      const validAssets = assets
        .map((asset) => ({
          name: asset.name,
          downloadUrl: asset.downloadUrl ?? asset.url,
        }))
        .filter((asset) => Boolean(asset.downloadUrl));

      if (validAssets.length === 0) {
        toast.error(tBrand("uploadErrors.invalidAssets"));
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
        objectKey: image.objectKey,
        previewUrl: image.signedUrl,
        signedUrl: image.signedUrl,
        signedUrlExpiresAt: image.signedUrlExpiresAt,
        name: image.name,
        partialMatchPatternName: DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
        shouldRevokePreviewUrl: false,
      }));

      setImages((current) => {
        const next = [...current, ...nextImages];
        imagesRef.current = next;
        return next;
      });
      if (matchPattern === "partial") {
        void openPartialCropDialog(nextImages[0].id);
      }
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

      const next = current.filter((image) => image.id !== imageId);
      imagesRef.current = next;
      return next;
    });
    if (cropImageId === imageId) {
      setCropImageId(null);
    }
  }

  function handleSubmit() {
    if (!trimmedName) {
      toast.error(t("validation.nameRequired"));
      return;
    }

    if (!ipTypeId) {
      toast.error(t("validation.typeRequired"));
      return;
    }

    if (!ipTypes.some((type) => type.id === ipTypeId)) {
      toast.error(t("validation.typeDeleted"));
      return;
    }

    if (images.length === 0) {
      toast.error(t("validation.imagesRequired"));
      return;
    }

    if (matchPattern === "partial" && pendingPartialCropCount > 0) {
      toast.error(t("validation.partialSelectionsRequired"));
      return;
    }

    const newUploadBytes = images.reduce((total, image) => total + (image.file?.size ?? 0), 0);
    if (newUploadBytes > MAX_TOTAL_NEW_REFERENCE_UPLOAD_BYTES) {
      toast.error(tBrand("uploadErrors.totalTooLarge"));
      return;
    }

    const formData = new FormData();
    if (mode === "edit" && ip) {
      formData.append("id", String(ip.id));
    }
    formData.append("name", trimmedName);
    formData.append("ipTypeId", String(ipTypeId));
    formData.append("description", description.trim());
    formData.append("matchPattern", matchPattern);
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
    formData.append(
      "existingImagePartialSelections",
      JSON.stringify(
        matchPattern === "partial"
          ? images
              .filter((image) => image.existingImageId && image.cropSelection)
              .map((image) => ({
                id: image.existingImageId,
                ...image.cropSelection,
              }))
          : [],
      ),
    );

    if (matchPattern === "partial") {
      formData.set(
        "assetLibraryUploadedImages",
        JSON.stringify(
          images
            .filter((image) => image.assetLibraryUploadedImage)
            .map((image) => ({
              ...image.assetLibraryUploadedImage!,
              ...image.cropSelection,
            })),
        ),
      );
    }

    for (const image of images) {
      if (image.file && matchPattern === "whole") {
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
        mode === "create" ? t("createProcessingSuccess") : t("updateProcessingSuccess"),
      );
    });
  }

  const cropDialogDraftImage = cropImageId
    ? (images.find((image) => image.id === cropImageId) ?? null)
    : null;
  const cropDialogImage: PartialFeatureCropDialogImage | null =
    cropDialogDraftImage &&
    cropDialogDraftImage.imageWidth &&
    cropDialogDraftImage.imageHeight &&
    cropDialogDraftImage.detections
      ? {
          id: cropDialogDraftImage.id,
          name: cropDialogDraftImage.name,
          previewUrl: cropDialogDraftImage.previewUrl,
          partialMatchPatternName:
            cropDialogDraftImage.partialMatchPatternName ?? DEFAULT_IP_PARTIAL_MATCH_PATTERN_NAME,
          imageWidth: cropDialogDraftImage.imageWidth,
          imageHeight: cropDialogDraftImage.imageHeight,
          detections: cropDialogDraftImage.detections,
        }
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[750px] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-[20px] p-0">
        <DialogHeader className="h-14 justify-center gap-0 px-5 py-4">
          <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
            {mode === "create" ? t("dialog.titleCreate") : t("dialog.titleEdit")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 pt-0 pb-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.ipNameLabel")}
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("dialog.ipNamePlaceholder")}
                className="h-8 w-[349px] rounded-[6px] border border-basic-4 px-3 py-0 text-[14px] leading-[22px] font-normal placeholder:text-[14px] placeholder:leading-[22px] placeholder:font-normal placeholder:text-basic-5"
              />
            </div>

            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.ipTypeLabel")}
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
                triggerClassName="h-8 w-[349px] rounded-[6px] border border-basic-4 px-3 py-0 text-[14px] leading-[22px] font-normal"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.matchPatternTitle")}
              </label>
              <p className="mt-1 text-[12px] leading-[16px] text-basic-5">
                {t("dialog.matchPatternDescription")}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-[12px]">
              <button
                type="button"
                onClick={() => setMatchPattern("whole")}
                disabled={isPending}
                className={cn(
                  "flex min-w-0 w-full flex-col gap-[6px] rounded-[8px] border border-basic-4 bg-background p-[12.5px] text-left transition-all",
                  matchPattern === "whole" ? "border-primary-5 bg-primary-1" : "hover:border-primary-5",
                )}
              >
                <span className="flex min-w-0 items-center gap-[6px]">
                  <span
                    className={cn(
                      "inline-flex size-[20px] shrink-0 items-center justify-center rounded-[6px]",
                      matchPattern === "whole"
                        ? "bg-primary-1 text-primary-6"
                        : "bg-primary-1 text-basic-8",
                    )}
                  >
                    <ImageIcon className="h-[20px] w-[20px]" />
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] font-medium leading-[20px] text-basic-8">
                    {t("dialog.matchWholeTitle")}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-[16px] shrink-0 items-center justify-center rounded-full border",
                      matchPattern === "whole"
                        ? "border-primary-6 bg-primary-6"
                        : "border-basic-4",
                    )}
                  >
                    {matchPattern === "whole" ? (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </span>
                </span>
                <span className="block text-[12px] font-normal leading-[18px] text-basic-6">
                  {t("dialog.matchWholeDescription")}
                </span>
                <span className="block text-[11px] font-normal leading-[16px] text-basic-5">
                  {t("dialog.matchWholeApplies")}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMatchPattern("partial");
                  const firstPending = imagesRef.current.find((image) => !image.cropSelection);
                  if (firstPending) {
                    void openPartialCropDialog(firstPending.id);
                  }
                }}
                disabled={isPending}
                className={cn(
                  "flex min-w-0 w-full flex-col gap-[6px] rounded-[8px] border border-basic-4 bg-background p-[12.5px] text-left transition-all",
                  matchPattern === "partial"
                    ? "border-primary-5 bg-primary-1"
                    : "hover:border-primary-5",
                )}
              >
                <span className="flex min-w-0 items-center gap-[6px]">
                  <span
                    className={cn(
                      "inline-flex size-[20px] shrink-0 items-center justify-center rounded-[6px]",
                      matchPattern === "partial"
                        ? "bg-primary-1 text-primary-6"
                        : "bg-primary-1 text-basic-8",
                    )}
                  >
                    <BoxSelect className="h-[20px] w-[20px]" />
                  </span>
                  <span className="min-w-0 flex-1 text-[14px] font-medium leading-[20px] text-basic-8">
                    {t("dialog.matchPartialTitle")}
                  </span>
                  <span
                    className={cn(
                      "inline-flex size-[16px] shrink-0 items-center justify-center rounded-full border",
                      matchPattern === "partial"
                        ? "border-primary-6 bg-primary-6"
                        : "border-basic-4",
                    )}
                  >
                    {matchPattern === "partial" ? (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </span>
                </span>
                <span className="block text-[12px] font-normal leading-[18px] text-basic-6">
                  {t("dialog.matchPartialDescription")}
                </span>
                <span className="block text-[11px] font-normal leading-[16px] text-basic-5">
                  {t("dialog.matchPartialApplies")}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.ipImagesLabel")}
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
                    className="relative flex h-[104px] w-[104px] flex-col items-center justify-center rounded-[6px] border border-basic-4 border-dashed bg-basic-1 px-2 py-10 text-basic-8 transition-colors hover:border-primary-5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <Plus className="h-[14px] w-[14px]" />
                      <span className="text-[14px] leading-[22px] font-normal">
                        {t("dialog.uploadImage")}
                      </span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="flex min-w-[180px] flex-col gap-[2px] rounded-[8px] border border-basic-3 p-1"
                >
                  <DropdownMenuItem
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-basic-8 hover:bg-primary-1 focus:bg-primary-1 data-[highlighted]:bg-primary-1"
                  >
                    <span
                      aria-hidden="true"
                      className="block h-[14px] w-[14px] shrink-0 bg-current [mask-image:url('/Icon/export.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
                    />
                    <span>{t("dialog.uploadLocal")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void handleSelectImagesFromAssetLibrary()}
                    className="h-8 gap-2 rounded-[6px] px-[10px] py-[5px] text-[14px] leading-[22px] font-normal text-basic-8 hover:bg-primary-1 focus:bg-primary-1 data-[highlighted]:bg-primary-1"
                  >
                    <span
                      aria-hidden="true"
                      className="block h-[14px] w-[14px] shrink-0 bg-current [mask-image:url('/Icon/Image.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
                    />
                    <span>{t("dialog.uploadFromLibrary")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative h-[104px] w-[104px] cursor-pointer overflow-hidden rounded-[6px] border border-basic-4 bg-basic-1"
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
                  {matchPattern === "partial" ? (
                    <button
                      type="button"
                      onClick={() => void openPartialCropDialog(image.id)}
                      className={cn(
                        "absolute top-1 left-1 z-10 inline-flex max-w-[94px] items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] leading-4 font-semibold text-white shadow-sm",
                        image.cropSelection ? "bg-primary-6" : "bg-danger-6",
                      )}
                    >
                      {image.cropSelection ? (
                        <>
                          <BoxSelect className="size-3" />
                          <span className="truncate">
                            {t(
                              `dialog.partialOptions.${image.cropSelection.partialMatchPatternName}`,
                            )}
                          </span>
                        </>
                      ) : (
                        <>
                          <span>!</span>
                          <span>{t("dialog.pendingCropBadge")}</span>
                        </>
                      )}
                    </button>
                  ) : null}
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
                      {matchPattern === "partial" ? (
                        <button
                          type="button"
                          aria-label={t("dialog.cropImage")}
                          onClick={() => void openPartialCropDialog(image.id)}
                          className="inline-flex h-4 w-4 items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                        >
                          <SquareDashedMousePointer className="h-4 w-4 text-white" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={t("dialog.closePreview")}
                        onClick={() => removeImage(image.id)}
                        className="inline-flex h-4 w-4 items-center justify-center opacity-90 transition-opacity hover:opacity-100"
                      >
                        <span
                          aria-hidden="true"
                          className="block h-4 w-4 shrink-0 bg-white [mask-image:url('/Icon/Delete.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:100%_100%]"
                        />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-start gap-[10px] rounded-[8px] border border-primary-5 bg-primary-1 px-3 py-[14px] text-[12px] leading-[16px] font-normal text-basic-8">
              <p className="text-[12px] leading-[16px] font-normal text-basic-8">
                💡 <span className="font-semibold">{t("dialog.uploadHintTitle")}</span>
                {matchPattern === "partial"
                  ? t("dialog.uploadHintPartial")
                  : t("dialog.uploadHint")}
              </p>
            </div>

            {pendingPartialCropCount > 0 ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-[8px] border border-danger-6 bg-danger-1 px-3 py-[12px] text-[13px] leading-[18px] text-danger-6">
                <span className="inline-flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  {t("dialog.pendingCropWarning", { count: pendingPartialCropCount })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const firstPending = pendingPartialCropImages[0];
                    if (firstPending) {
                      void openPartialCropDialog(firstPending.id);
                    }
                  }}
                  className="shrink-0 text-[13px] leading-[18px] font-semibold text-danger-6 hover:text-danger-7"
                >
                  {t("dialog.goCrop")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.descriptionLabel")}
                <span className="ml-2 text-[12px] leading-[16px] font-normal text-basic-5">
                  {t("dialog.notesOptional")}
                </span>
              </label>
              <p className="text-[12px] leading-[16px] font-normal text-basic-5">
                {t("dialog.descriptionHint")}
              </p>
            </div>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("dialog.descriptionPlaceholder")}
              className="h-[60px] rounded-[6px] border border-basic-4 px-4 py-2"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="space-y-1">
              <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
                {t("dialog.linkedTagsLabel")}
              </label>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] leading-[16px] font-normal text-basic-5">
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
                  className="inline-flex items-center gap-1 text-[12px] leading-[16px] font-normal text-primary-6 transition-opacity hover:opacity-80"
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
              collapsedUntilFocus
              dialogOpen={open}
            />
          </div>

          <div className="mt-4 space-y-2">
            <label className="h-[22px] text-[14px] leading-[22px] font-normal text-basic-8">
              {t("dialog.notesLabel")}
              <span className="ml-2 text-[12px] leading-[16px] font-normal text-basic-5">
                {t("dialog.notesOptional")}
              </span>
            </label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t("dialog.notesPlaceholder")}
              className="h-[60px] rounded-[6px] border border-basic-4 px-4 py-2"
            />
          </div>
        </div>

        <DialogFooter className="min-h-16 gap-[10px] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-8 w-20 rounded-[6px] border border-basic-4 px-3 py-1"
          >
            {t("dialog.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="h-8 w-20 rounded-[6px] border border-basic-4 px-3 py-1"
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
      <IpPartialFeatureCropDialog
        open={Boolean(cropImageId)}
        image={cropDialogImage}
        detecting={isPreparingCrop}
        t={t}
        onOpenChange={handleCropDialogOpenChange}
        onFeatureChange={(featureName) => void handleCropFeatureChange(featureName)}
        onConfirm={handleConfirmPartialCrop}
      />
    </Dialog>
  );
}
