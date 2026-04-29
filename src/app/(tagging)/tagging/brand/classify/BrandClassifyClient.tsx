/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLIENT_IMAGE_PREPARATION_ERROR_CODES,
  getClientImagePreparationErrorCode,
  prepareClientImageUpload,
} from "@/lib/brand/browser-image";
import { cn } from "@/lib/utils";
import { ArrowLeft, Loader2, Search, Trophy, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { classifyBrandImageAction, prepareBrandClassificationAction } from "../actions";
import {
  BrandClassificationResult,
  BrandDetectionBox,
  BrandLibraryPageData,
} from "../types";

type ProductImageMeta = {
  width: number;
  height: number;
};

type TranslationFunction = (key: string) => string;

function revokeUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getUploadErrorMessage(error: unknown, t: TranslationFunction) {
  switch (getClientImagePreparationErrorCode(error)) {
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.fileTooLarge:
      return t("errors.fileTooLarge");
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.imageLoadFailed:
      return t("errors.imageLoadFailed");
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionTargetUnreachable:
      return t("errors.compressionTargetUnreachable");
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed:
      return t("errors.compressionFailed");
    default:
      return error instanceof Error ? error.message : t("errors.processingFailed");
  }
}

function getFallbackBox(meta: ProductImageMeta): BrandDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: meta.width,
    yMax: meta.height,
    score: 1,
    label: "whole image fallback",
  };
}

function clampBox(box: BrandDetectionBox, meta: ProductImageMeta) {
  const xMin = Math.max(0, Math.min(meta.width, box.xMin));
  const yMin = Math.max(0, Math.min(meta.height, box.yMin));
  const xMax = Math.max(xMin + 1, Math.min(meta.width, box.xMax));
  const yMax = Math.max(yMin + 1, Math.min(meta.height, box.yMax));

  return {
    ...box,
    xMin,
    yMin,
    xMax,
    yMax,
  };
}

function getDetectionLabelPosition(box: BrandDetectionBox, meta: ProductImageMeta) {
  const left = (box.xMin / meta.width) * 100;
  const top = (box.yMin / meta.height) * 100;
  const bottom = (box.yMax / meta.height) * 100;
  const placeBelow = top < 10;

  return {
    left: `min(calc(${left}% + 8px), calc(100% - 12px))`,
    top: placeBelow ? `calc(${bottom}% + 8px)` : `calc(${top}% - 8px)`,
    transform: placeBelow ? "translateY(0)" : "translateY(-100%)",
    maxWidth: `min(280px, calc(100% - ${left}% - 12px))`,
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

async function cropImageToDataUrl({
  imageSrc,
  meta,
  box,
}: {
  imageSrc: string;
  meta: ProductImageMeta;
  box: BrandDetectionBox;
}) {
  const image = await loadImage(imageSrc);
  const crop = clampBox(box, meta);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.xMax - crop.xMin));
  canvas.height = Math.max(1, Math.round(crop.yMax - crop.yMin));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("浏览器不支持 Canvas 裁剪");
  }

  context.drawImage(
    image,
    crop.xMin,
    crop.yMin,
    crop.xMax - crop.xMin,
    crop.yMax - crop.yMin,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL("image/png");
}

export default function BrandClassifyClient({ initialData }: { initialData: BrandLibraryPageData }) {
  const t = useTranslations("Tagging.BrandClassify") as TranslationFunction;
  const referenceLogos = useMemo(
    () => initialData.logos.filter((logo) => logo.enabled && logo.status === "completed"),
    [initialData.logos],
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<ProductImageMeta | null>(null);
  const [detections, setDetections] = useState<BrandDetectionBox[]>([]);
  const [result, setResult] = useState<BrandClassificationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    return () => {
      revokeUrl(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = "";

    setDetections([]);
    setResult(null);
    setImageMeta(null);
    setFile(null);
    setPreviewUrl((current) => {
      revokeUrl(current);
      return null;
    });

    if (!selectedFile) {
      return;
    }

    try {
      const nextFile = await prepareClientImageUpload(selectedFile);
      setFile(nextFile);
      setPreviewUrl((current) => {
        revokeUrl(current);
        return URL.createObjectURL(nextFile);
      });

      const objectUrl = URL.createObjectURL(nextFile);
      try {
        const image = await loadImage(objectUrl);
        setImageMeta({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      toast.error(getUploadErrorMessage(error, t));
    }
  }

  async function handleClassify() {
    if (!file || !previewUrl || !imageMeta) {
      toast.error(t("uploadImageFirst"));
      return;
    }

    if (referenceLogos.length === 0) {
      toast.error(t("noReferenceLogos"));
      return;
    }

    setIsRunning(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const prepareResult = await prepareBrandClassificationAction(formData);
      if (!prepareResult.success) {
        toast.error(prepareResult.message);
        return;
      }

      const candidateBoxes =
        prepareResult.data.detections.length > 0
          ? prepareResult.data.detections
          : [getFallbackBox(imageMeta)];

      const normalizedBoxes = candidateBoxes.map((box) => clampBox(box, imageMeta));
      setDetections(normalizedBoxes);

      const crops = await Promise.all(
        normalizedBoxes.map(async (box) => ({
          box,
          image: await cropImageToDataUrl({
            imageSrc: previewUrl,
            meta: imageMeta,
            box,
          }),
        })),
      );

      const classifyResult = await classifyBrandImageAction({ crops });
      if (!classifyResult.success) {
        toast.error(classifyResult.message);
        return;
      }

      setResult(classifyResult.data.result);
      toast.success(
        classifyResult.data.result.noConfidentMatch ? t("classifyCompleteNoMatch") : t("classifyComplete"),
      );
    } catch (error) {
      console.error("Failed to classify brand image:", error);
      toast.error(error instanceof Error ? error.message : t("classifyFailed"));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 px-1 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-basic-5">
            <Link href="/tagging/brand" className="inline-flex items-center gap-1 hover:text-basic-8">
              <ArrowLeft className="size-4" />
              {t("backToLibrary")}
            </Link>
          </div>
          <h2 className="mt-3 text-[28px] leading-[40px] font-semibold text-basic-8">
            {t("pageTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-basic-5">
            {t("pageDescription")}
          </p>
        </div>

        <div className="rounded-[18px] border bg-background px-5 py-4 text-right">
          <div className="text-sm text-basic-5">{t("availableLogos")}</div>
          <div className="mt-1 text-3xl font-semibold text-basic-8">{referenceLogos.length}</div>
          <div className="mt-1 text-xs text-basic-5">{t("statsDescription")}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <div className="space-y-6 rounded-[24px] border bg-background p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Input type="file" accept="image/*,.svg" onChange={handleFileChange} className="max-w-[320px]" />
            <Button type="button" onClick={handleClassify} disabled={isRunning || !file || referenceLogos.length === 0}>
              {isRunning ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("classifying")}
                </>
              ) : (
                <>
                  <Search className="size-4" />
                  {t("classifyButton")}
                </>
              )}
            </Button>
          </div>

          <div className="rounded-[20px] border border-dashed border-[#d9e2f2] bg-[#f8fbff] p-4">
            {previewUrl && imageMeta ? (
              <div className="flex justify-center">
                <div className="relative inline-block max-w-full overflow-hidden rounded-[16px] isolate">
                  <div className="overflow-hidden rounded-[16px] bg-[#eef3fb]">
                    <img
                      src={previewUrl}
                      alt={t("uploadProductImage")}
                      className="block h-auto max-h-[720px] max-w-full"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0">
                    {detections.map((box, index) => {
                      const active = result?.winningDetectionIndex === index;
                      const left = (box.xMin / imageMeta.width) * 100;
                      const top = (box.yMin / imageMeta.height) * 100;
                      const width = ((box.xMax - box.xMin) / imageMeta.width) * 100;
                      const height = ((box.yMax - box.yMin) / imageMeta.height) * 100;

                      const labelPosition = getDetectionLabelPosition(box, imageMeta);

                      return (
                        <Fragment key={`${box.label}-${index}`}>
                          <div
                            className={cn(
                              "absolute rounded-[14px] border-2",
                              active
                                ? "border-[#ff8f1f] bg-[rgba(255,143,31,0.10)] shadow-[0_0_0_1px_rgba(255,143,31,0.18)]"
                                : "border-[#3370ff]/70",
                            )}
                            style={{
                              left: `${left}%`,
                              top: `${top}%`,
                              width: `${width}%`,
                              height: `${height}%`,
                            }}
                          />
                          <span
                            className={cn(
                              "absolute z-10 overflow-hidden text-ellipsis rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-sm",
                              active ? "bg-[#ff8f1f]" : "bg-[#3370ff]",
                            )}
                            style={labelPosition}
                          >
                            {active ? "Winning box" : `Box ${index + 1}`} · {box.label}
                          </span>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center text-basic-5">
                <Upload className="size-10" />
                <p>{t("uploadHint")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[24px] border bg-background p-6">
            <div className="flex items-center gap-2 text-lg font-semibold text-basic-8">
              <Trophy className="size-5 text-[#ff8f1f]" />
              {t("finalResult")}
            </div>

            {!result ? (
              <p className="mt-4 text-sm leading-6 text-basic-5">
                {t("resultHint")}
              </p>
            ) : result.noConfidentMatch ? (
              <div className="mt-4 rounded-[18px] border border-[#ffd8a8] bg-[#fff9f2] p-4">
                <p className="text-base font-medium text-basic-8">{t("noConfidentMatch")}</p>
                <p className="mt-2 text-sm leading-6 text-basic-5">
                  {t("noConfidentMatchDesc")}
                </p>
                {result.bestMatch ? (
                  <div className="mt-4 rounded-[14px] bg-white/80 px-4 py-3 text-sm">
                    <div className="font-medium text-basic-8">{result.bestMatch.logoName}</div>
                    <div className="mt-1 text-basic-5">
                      similarity {formatPercent(result.bestMatch.similarity)} · confidence{" "}
                      {result.bestMatch.confidence} · box {result.bestMatch.detectionIndex + 1}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : result.bestMatch ? (
              <div className="mt-4 rounded-[18px] border border-[#b8f0ca] bg-[#f4fff7] p-4">
                <p className="text-sm text-basic-5">{t("winningLogo")}</p>
                <p className="mt-2 text-2xl font-semibold text-basic-8">{result.bestMatch.logoName}</p>
                <p className="mt-2 text-sm leading-6 text-basic-5">
                  {t("bestMatchType")} {result.bestMatch.logoTypeName} · {t("similarity")}{" "}
                  {formatPercent(result.bestMatch.similarity)} · {t("confidence")} {result.bestMatch.confidence}
                </p>
                <p className="mt-1 text-sm text-basic-5">
                  {t("winningBox")}: #{result.bestMatch.detectionIndex + 1}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">{t("topMatches")}</h3>
            <div className="mt-4 space-y-3">
              {result?.topMatches.length ? (
                result.topMatches.map((match, index) => (
                  <div
                    key={`${match.assetLogoId}-${index}`}
                    className={cn(
                      "rounded-[18px] border px-4 py-3",
                      index === 0 ? "border-[#ffd8a8] bg-[#fffaf4]" : "border-[#d9e2f2] bg-[#fafcff]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-basic-8">{match.logoName}</div>
                      <div className="text-sm text-basic-5">#{index + 1}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-basic-5">
                      {t("similarity")} {formatPercent(match.similarity)} · {t("confidence")} {match.confidence}
                    </div>
                    <div className="text-sm leading-6 text-basic-5">
                      {t("bestMatchType")} {match.logoTypeName} · box {match.detectionIndex + 1}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-basic-5">{t("noMatches")}</p>
              )}
            </div>
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">{t("detectionBoxes")}</h3>
            <div className="mt-4 space-y-3">
              {detections.length > 0 ? (
                detections.map((box, index) => (
                  <div
                    key={`${box.label}-${index}-meta`}
                    className={cn(
                      "rounded-[16px] border px-4 py-3 text-sm",
                      result?.winningDetectionIndex === index
                        ? "border-[#ff8f1f] bg-[#fff8ef]"
                        : "border-[#d9e2f2] bg-[#fafcff]",
                    )}
                  >
                    <div className="font-medium text-basic-8">
                      Box {index + 1} · {box.label}
                    </div>
                    <div className="mt-1 leading-6 text-basic-5">
                      ({Math.round(box.xMin)}, {Math.round(box.yMin)}) to ({Math.round(box.xMax)},{" "}
                      {Math.round(box.yMax)}) · detector score {formatPercent(box.score)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-basic-5">{t("noDetectionData")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
