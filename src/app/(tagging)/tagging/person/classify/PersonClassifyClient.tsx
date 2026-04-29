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
import { classifyPersonImageAction, preparePersonClassificationAction } from "../actions";
import {
  PersonClassificationResult,
  PersonDetectionBox,
  PersonFaceClassificationResult,
  PersonLibraryPageData,
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

function getUploadErrorMessage(error: unknown, t: (key: string) => string) {
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

function clampBox(box: PersonDetectionBox, meta: ProductImageMeta) {
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

function getDetectionLabelPosition(box: PersonDetectionBox, meta: ProductImageMeta) {
  const left = (box.xMin / meta.width) * 100;
  const top = (box.yMin / meta.height) * 100;
  const bottom = (box.yMax / meta.height) * 100;
  const placeBelow = top < 10;

  return {
    left: `min(calc(${left}% + 8px), calc(100% - 12px))`,
    top: placeBelow ? `calc(${bottom}% + 8px)` : `calc(${top}% - 8px)`,
    transform: placeBelow ? "translateY(0)" : "translateY(-100%)",
    maxWidth: `min(320px, calc(100% - ${left}% - 12px))`,
  };
}

function loadImage(src: string, t: (key: string) => string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("errors.imageLoadFailed")));
    image.src = src;
  });
}

function getFaceResult(
  result: PersonClassificationResult | null,
  detectionIndex: number,
): PersonFaceClassificationResult | null {
  return result?.faces.find((face) => face.detectionIndex === detectionIndex) ?? null;
}

export default function PersonClassifyClient({
  initialData,
}: {
  initialData: PersonLibraryPageData;
}) {
  const t = useTranslations("Tagging.PersonClassify") as TranslationFunction;
  const referencePersons = useMemo(
    () => initialData.persons.filter((person) => person.enabled && person.status === "completed"),
    [initialData.persons],
  );
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<ProductImageMeta | null>(null);
  const [detections, setDetections] = useState<PersonDetectionBox[]>([]);
  const [result, setResult] = useState<PersonClassificationResult | null>(null);
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
        const image = await loadImage(objectUrl, t);
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

    if (referencePersons.length === 0) {
      toast.error(t("noReferencePersons"));
      return;
    }

    setIsRunning(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const prepareResult = await preparePersonClassificationAction(formData);
      if (!prepareResult.success) {
        toast.error(prepareResult.message);
        return;
      }

      const normalizedBoxes = prepareResult.data.detections.map((box) => clampBox(box, imageMeta));
      setDetections(normalizedBoxes);

      if (normalizedBoxes.length === 0) {
        setResult(null);
        toast.warning(t("noFacesDetected"));
        return;
      }

      const faces = normalizedBoxes
        .map((box, detectionIndex) =>
          box.embedding
            ? {
                detectionIndex,
                box,
                embedding: box.embedding,
              }
            : null,
        )
        .filter(
          (face): face is { detectionIndex: number; box: PersonDetectionBox; embedding: number[] } =>
            Boolean(face),
        );

      if (faces.length !== normalizedBoxes.length) {
        toast.error(t("errors.missingEmbedding"));
        return;
      }

      const classifyResult = await classifyPersonImageAction({ faces });
      if (!classifyResult.success) {
        toast.error(classifyResult.message);
        return;
      }

      setResult(classifyResult.data.result);
      const confidentCount = classifyResult.data.result.faces.filter(
        (face) => !face.noConfidentMatch && face.bestMatch,
      ).length;
      toast.success(
        confidentCount > 0 ? t("classifyComplete") : t("classifyCompleteNoMatch"),
      );
    } catch (error) {
      console.error("Failed to classify person image:", error);
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
            <Link href="/tagging/person" className="inline-flex items-center gap-1 hover:text-basic-8">
              <ArrowLeft className="size-4" />
              {t("backToLibrary")}
            </Link>
          </div>
          <h2 className="mt-3 text-[28px] leading-[40px] font-semibold text-basic-8">
            {t("pageTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-basic-5">{t("pageDescription")}</p>
        </div>

        <div className="rounded-[18px] border bg-background px-5 py-4 text-right">
          <div className="text-sm text-basic-5">{t("availablePersons")}</div>
          <div className="mt-1 text-3xl font-semibold text-basic-8">
            {referencePersons.length}
          </div>
          <div className="mt-1 text-xs text-basic-5">{t("statsDescription")}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_440px]">
        <div className="space-y-6 rounded-[24px] border bg-background p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Input
              type="file"
              accept="image/*,.svg"
              onChange={handleFileChange}
              className="max-w-[320px]"
            />
            <Button
              type="button"
              onClick={handleClassify}
              disabled={isRunning || !file || referencePersons.length === 0}
            >
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
                <div className="relative isolate inline-block max-w-full overflow-hidden rounded-[16px]">
                  <div className="overflow-hidden rounded-[16px] bg-[#eef3fb]">
                    <img
                      src={previewUrl}
                      alt={t("imageToClassify")}
                      className="block h-auto max-h-[720px] max-w-full"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0">
                    {detections.map((box, index) => {
                      const faceResult = getFaceResult(result, index);
                      const hasConfidentMatch =
                        Boolean(faceResult?.bestMatch) && !faceResult?.noConfidentMatch;
                      const left = (box.xMin / imageMeta.width) * 100;
                      const top = (box.yMin / imageMeta.height) * 100;
                      const width = ((box.xMax - box.xMin) / imageMeta.width) * 100;
                      const height = ((box.yMax - box.yMin) / imageMeta.height) * 100;
                      const labelPosition = getDetectionLabelPosition(box, imageMeta);
                      const label = faceResult?.bestMatch
                        ? `${faceResult.bestMatch.personName} · ${faceResult.bestMatch.confidence}`
                        : `${t("face")} ${index + 1}`;

                      return (
                        <Fragment key={`${box.label}-${index}`}>
                          <div
                            className={cn(
                              "absolute rounded-[14px] border-2",
                              hasConfidentMatch
                                ? "border-[#00d68f] bg-[rgba(0,214,143,0.10)] shadow-[0_0_0_1px_rgba(0,214,143,0.18)]"
                                : faceResult
                                  ? "border-[#ff8f1f] bg-[rgba(255,143,31,0.10)]"
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
                              hasConfidentMatch
                                ? "bg-[#00d68f]"
                                : faceResult
                                  ? "bg-[#ff8f1f]"
                                  : "bg-[#3370ff]",
                            )}
                            style={labelPosition}
                          >
                            {label}
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
              <p className="mt-4 text-sm leading-6 text-basic-5">{t("resultHint")}</p>
            ) : result.faces.length === 0 ? (
              <div className="mt-4 rounded-[18px] border border-[#ffd8a8] bg-[#fff9f2] p-4">
                <p className="text-base font-medium text-basic-8">{t("noFacesDetected")}</p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {result.faces.map((face) => (
                  <div
                    key={face.detectionIndex}
                    className={cn(
                      "rounded-[18px] border p-4",
                      face.bestMatch && !face.noConfidentMatch
                        ? "border-[#b8f0ca] bg-[#f4fff7]"
                        : "border-[#ffd8a8] bg-[#fff9f2]",
                    )}
                  >
                    <p className="text-sm text-basic-5">
                      {t("face")} {face.detectionIndex + 1}
                    </p>
                    {face.bestMatch ? (
                      <>
                        <p className="mt-2 text-2xl font-semibold text-basic-8">
                          {face.bestMatch.personName}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-basic-5">
                          {t("type")} {face.bestMatch.personTypeName} · {t("similarity")}{" "}
                          {formatPercent(face.bestMatch.similarity)} · {t("confidence")}{" "}
                          {face.bestMatch.confidence}
                        </p>
                        {face.noConfidentMatch ? (
                          <p className="mt-2 text-sm leading-6 text-basic-5">
                            {t("noConfidentMatchDesc")}
                          </p>
                        ) : null}
                        {face.bestMatch.recommendedTags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {face.bestMatch.recommendedTags.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center rounded-[6px] border border-[#C5CEE0] bg-white px-2 py-1 text-xs text-basic-8"
                              >
                                {tag.tagPath.join(" > ")}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-basic-5">
                        {t("noConfidentMatch")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">{t("topMatches")}</h3>
            <div className="mt-4 space-y-4">
              {result?.faces.length ? (
                result.faces.map((face) => (
                  <div key={`ranking-${face.detectionIndex}`} className="space-y-3">
                    <h4 className="text-sm font-medium text-basic-8">
                      {t("face")} {face.detectionIndex + 1}
                    </h4>
                    {face.topMatches.length > 0 ? (
                      face.topMatches.map((match, index) => (
                        <div
                          key={`${match.assetPersonId}-${face.detectionIndex}-${index}`}
                          className={cn(
                            "rounded-[18px] border px-4 py-3",
                            index === 0
                              ? "border-[#ffd8a8] bg-[#fffaf4]"
                              : "border-[#d9e2f2] bg-[#fafcff]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-basic-8">{match.personName}</div>
                            <div className="text-sm text-basic-5">#{index + 1}</div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-basic-5">
                            {t("similarity")} {formatPercent(match.similarity)} ·{" "}
                            {t("confidence")} {match.confidence}
                          </div>
                          <div className="text-sm leading-6 text-basic-5">
                            {t("type")} {match.personTypeName} · {t("supportingReferences")}{" "}
                            {match.supportingReferenceCount}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-basic-5">{t("noMatches")}</p>
                    )}
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
                      getFaceResult(result, index)?.bestMatch
                        ? "border-[#ff8f1f] bg-[#fff8ef]"
                        : "border-[#d9e2f2] bg-[#fafcff]",
                    )}
                  >
                    <div className="font-medium text-basic-8">
                      {t("face")} {index + 1}
                    </div>
                    <div className="mt-1 leading-6 text-basic-5">
                      ({Math.round(box.xMin)}, {Math.round(box.yMin)}) to ({Math.round(box.xMax)},{" "}
                      {Math.round(box.yMax)}) · {t("detectorScore")} {formatPercent(box.score)}
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
