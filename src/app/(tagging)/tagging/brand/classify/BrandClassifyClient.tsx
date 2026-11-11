/* eslint-disable @next/next/no-img-element */
"use client";

import {
  clampClassificationBox,
  ClassificationImageMeta,
  getClassificationBoxPercentages,
  getClassificationImageFrameStyle,
  getClassificationLabelPosition,
} from "@/app/(tagging)/tagging/components/classification-image-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLIENT_IMAGE_PREPARATION_ERROR_CODES,
  getClientImagePreparationErrorCode,
  prepareClientImageUpload,
} from "@/lib/brand/browser-image";
import { CLASSIFICATION_MEDIA_ACCEPT } from "@/lib/feature-library";
import { uploadS3ObjectFromBrowser } from "@/lib/s3-browser-upload";
import { cn } from "@/lib/utils";
import { ArrowLeft, Loader2, Search, Trophy, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getVideoExtension } from "../../components/classification-video";
import { classifyFeatureVideoAction } from "../../components/classification-video-actions";
import {
  ClassificationMediaHint,
  ClassificationVideoPreview,
  ImportClassificationVideoButton,
  useClassificationVideo,
} from "../../components/ClassificationVideoInput";
import {
  FeatureClassificationContextInputs,
  FeatureDecisionComparison,
  FeatureDecisionDiagnosticsPanel,
  FeatureDecisionPredictions,
  useFeatureDecisionComparison,
} from "../../components/FeatureDecisionDiagnosticsPanel";
import {
  classifyBrandImageAction,
  prepareBrandClassificationAction,
  prepareLogoImageUploadAction,
} from "../actions";
import { BrandClassificationResult, BrandDetectionBox, BrandLibraryPageData } from "../types";

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

function getFallbackBox(meta: ClassificationImageMeta): BrandDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: meta.width,
    yMax: meta.height,
    score: 1,
    label: "whole image fallback",
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

export default function BrandClassifyClient({
  initialData,
}: {
  initialData: BrandLibraryPageData;
}) {
  const t = useTranslations("Tagging.BrandClassify") as TranslationFunction;
  const diagnosticsT = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const referenceLogos = useMemo(
    () => initialData.logos.filter((logo) => logo.enabled && logo.status === "completed"),
    [initialData.logos],
  );
  const [file, setFile] = useState<File | null>(null);
  const { video, clearVideo, selectLocalVideo, importVideo, isImporting, getVideoSource } =
    useClassificationVideo();
  const [imageMode, setImageMode] = useState(false);
  const { runs, recordRun, resetRuns } = useFeatureDecisionComparison();
  const [fileName, setFileName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<ClassificationImageMeta | null>(null);
  const [detectionImageMeta, setDetectionImageMeta] = useState<ClassificationImageMeta | null>(
    null,
  );
  const [detections, setDetections] = useState<BrandDetectionBox[]>([]);
  const [result, setResult] = useState<BrandClassificationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    return () => {
      revokeUrl(previewUrl);
    };
  }, [previewUrl]);

  function resetMediaSelection(name: string, folder = "") {
    resetRuns();
    setDetections([]);
    setResult(null);
    setImageMeta(null);
    setDetectionImageMeta(null);
    setFile(null);
    setFileName(name);
    setFolderPath(folder);
    setPreviewUrl(null);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    clearVideo();
    resetMediaSelection(selectedFile.name);
    if (getVideoExtension(selectedFile.name)) {
      selectLocalVideo(selectedFile);
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
    if (!video && (!file || !previewUrl || !imageMeta)) {
      toast.error(t("uploadImageFirst"));
      return;
    }

    if (referenceLogos.length === 0) {
      toast.error(t("noReferenceLogos"));
      return;
    }

    setIsRunning(true);
    setResult(null);
    try {
      const classifyResult = video
        ? await classifySelectedVideo()
        : file && (await classifySelectedImage(file));
      if (!classifyResult) return;
      if (!classifyResult.success) {
        toast.error(classifyResult.message);
        return;
      }

      setResult(classifyResult.data.result);
      if (classifyResult.data.result.diagnostics) {
        recordRun(
          classifyResult.data.result.diagnostics,
          classifyResult.data.result.topMatches.map((match) => ({
            name: match.logoName,
            confidence: match.confidence,
          })),
        );
      }
      if (classifyResult.data.result.diagnostics?.decision.status === "failed") {
        toast.error(classifyResult.data.result.diagnostics.decision.error ?? t("classifyFailed"));
        return;
      }
      const hasPredictions =
        classifyResult.data.result.diagnostics?.mode === "llm"
          ? classifyResult.data.result.topMatches.length > 0
          : !classifyResult.data.result.noConfidentMatch;
      toast.success(hasPredictions ? t("classifyComplete") : t("classifyCompleteNoMatch"));
    } catch (error) {
      console.error("Failed to classify brand image:", error);
      toast.error(error instanceof Error ? error.message : t("classifyFailed"));
    } finally {
      setIsRunning(false);
    }
  }

  async function classifySelectedVideo(): ReturnType<typeof classifyBrandImageAction> {
    const response = await classifyFeatureVideoAction({
      source: await getVideoSource(),
      featureType: "logo",
      imageMode,
      fileName,
      folderPath,
    });
    if (!response.success) return response;
    const result = response.data.brand;
    if (!result) return { success: false, message: t("classifyFailed") };
    return { success: true, data: { result } };
  }

  async function classifySelectedImage(file: File) {
    const contentType = file.type || "application/octet-stream";
    const uploadPrepareResult = await prepareLogoImageUploadAction({
      name: file.name,
      mimeType: contentType,
      size: file.size,
    });
    if (!uploadPrepareResult.success) {
      toast.error(uploadPrepareResult.message);
      return;
    }

    const uploadResponse = await uploadS3ObjectFromBrowser({
      uploadUrl: uploadPrepareResult.data.image.uploadUrl,
      file,
      contentType: uploadPrepareResult.data.image.mimeType,
    });
    if (!uploadResponse.ok) {
      toast.error(t("errors.imageLoadFailed"));
      return;
    }

    const prepareResult = await prepareBrandClassificationAction({
      objectKey: uploadPrepareResult.data.image.objectKey,
      mimeType: uploadPrepareResult.data.image.mimeType,
      size: uploadPrepareResult.data.image.size,
    });
    if (!prepareResult.success) {
      toast.error(prepareResult.message);
      return;
    }

    const nextDetectionImageMeta = {
      width: prepareResult.data.imageWidth,
      height: prepareResult.data.imageHeight,
    };
    const candidateBoxes =
      prepareResult.data.detections.length > 0
        ? prepareResult.data.detections
        : [getFallbackBox(nextDetectionImageMeta)];

    const normalizedBoxes = candidateBoxes.map((box) =>
      clampClassificationBox(box, nextDetectionImageMeta),
    );
    setDetectionImageMeta(nextDetectionImageMeta);
    setDetections(normalizedBoxes);

    return classifyBrandImageAction({
      objectKey: uploadPrepareResult.data.image.objectKey,
      mimeType: uploadPrepareResult.data.image.mimeType,
      size: uploadPrepareResult.data.image.size,
      imageMode,
      fileName,
      folderPath,
      boxes: normalizedBoxes,
    });
  }

  const boxImageMeta = detectionImageMeta ?? imageMeta;

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 px-1 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-basic-5">
            <Link
              href="/tagging/brand"
              className="inline-flex items-center gap-1 hover:text-basic-8"
            >
              <ArrowLeft className="size-4" />
              {t("backToLibrary")}
            </Link>
          </div>
          <h2 className="mt-3 text-[28px] leading-[40px] font-semibold text-basic-8">
            {t("pageTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-basic-5">
            {diagnosticsT("algorithmDescription")}
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
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              type="file"
              accept={CLASSIFICATION_MEDIA_ACCEPT}
              disabled={isRunning || isImporting}
              onChange={handleFileChange}
              className="max-w-[320px]"
            />
            <ImportClassificationVideoButton
              disabled={isRunning}
              isImporting={isImporting}
              onClick={() => void importVideo(resetMediaSelection)}
            />
            <Button
              type="button"
              onClick={handleClassify}
              disabled={
                isRunning || isImporting || (!file && !video) || referenceLogos.length === 0
              }
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

          <FeatureClassificationContextInputs
            imageMode={imageMode}
            onImageModeChange={setImageMode}
            fileName={fileName}
            folderPath={folderPath}
            onFileNameChange={(value) => {
              setFileName(value);
              resetRuns();
              setResult(null);
            }}
            onFolderPathChange={(value) => {
              setFolderPath(value);
              resetRuns();
              setResult(null);
            }}
            disabled={isRunning}
          />

          <div className="rounded-[20px] border border-dashed border-basic-3 bg-basic-1 p-4">
            {video ? (
              <ClassificationVideoPreview key={video.url} video={video} />
            ) : previewUrl && imageMeta && boxImageMeta ? (
              <div className="flex justify-center">
                <div
                  className="relative isolate overflow-hidden rounded-[16px] bg-[#eef3fb]"
                  style={getClassificationImageFrameStyle(imageMeta)}
                >
                  <img
                    src={previewUrl}
                    alt={t("uploadProductImage")}
                    className="block h-full w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {detections.map((box, index) => {
                      const active = result?.winningDetectionIndex === index;
                      const boxStyle = getClassificationBoxPercentages(box, boxImageMeta);
                      const labelPosition = getClassificationLabelPosition(box, boxImageMeta);

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
                              left: `${boxStyle.left}%`,
                              top: `${boxStyle.top}%`,
                              width: `${boxStyle.width}%`,
                              height: `${boxStyle.height}%`,
                            }}
                          />
                          <span
                            className={cn(
                              "absolute z-10 overflow-hidden text-ellipsis rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-sm",
                              active ? "bg-[#ff8f1f]" : "bg-[#3370ff]",
                            )}
                            style={labelPosition}
                          >
                            {active ? diagnosticsT("retrievalRegion") : `Box ${index + 1}`} ·{" "}
                            {box.label}
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
                <ClassificationMediaHint />
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

            {result?.diagnostics?.mode === "llm" &&
            result.diagnostics.decision.status === "completed" ? (
              <FeatureDecisionPredictions
                diagnostics={result.diagnostics}
                names={Object.fromEntries(
                  result.topMatches.map((match) => [`logo:${match.assetLogoId}`, match.logoName]),
                )}
                acceptedCandidateIds={(result.matches ?? []).map(
                  (match) => `logo:${match.assetLogoId}`,
                )}
              />
            ) : !result ? (
              <p className="mt-4 text-sm leading-6 text-basic-5">{diagnosticsT("resultHint")}</p>
            ) : result.noConfidentMatch ? (
              <div className="mt-4 rounded-[18px] border border-warning-4 bg-warning-1 p-4">
                <p className="text-base font-medium text-basic-8">{t("noConfidentMatch")}</p>
                <p className="mt-2 text-sm leading-6 text-basic-5">
                  {diagnosticsT("noFinalMatch")}
                </p>
                {result.bestMatch ? (
                  <div className="mt-4 rounded-[14px] border border-basic-3 bg-background/80 px-4 py-3 text-sm">
                    <div className="font-medium text-basic-8">{result.bestMatch.logoName}</div>
                    <div className="mt-1 text-basic-5">
                      {diagnosticsT("retrievalSimilarity")}{" "}
                      {formatPercent(result.bestMatch.similarity)} ·{" "}
                      {diagnosticsT(
                        result?.diagnostics?.mode === "legacy"
                          ? "legacyConfidence"
                          : "llmConfidence",
                      )}{" "}
                      {result.bestMatch.confidence} · {diagnosticsT("retrievalRegion")}{" "}
                      {result.bestMatch.detectionIndex + 1}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : result.bestMatch ? (
              <div className="mt-4 rounded-[18px] border border-success-4 bg-success-1 p-4">
                <p className="text-sm text-basic-5">{t("winningLogo")}</p>
                <p className="mt-2 text-2xl font-semibold text-basic-8">
                  {result.bestMatch.logoName}
                </p>
                <p className="mt-2 text-sm leading-6 text-basic-5">
                  {t("bestMatchType")} {result.bestMatch.logoTypeName} ·{" "}
                  {diagnosticsT("retrievalSimilarity")} {formatPercent(result.bestMatch.similarity)}{" "}
                  ·{" "}
                  {diagnosticsT(
                    result?.diagnostics?.mode === "legacy" ? "legacyConfidence" : "llmConfidence",
                  )}{" "}
                  {result.bestMatch.confidence}
                </p>
                <p className="mt-1 text-sm text-basic-5">
                  {diagnosticsT("retrievalRegion")}: #{result.bestMatch.detectionIndex + 1}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">
              {diagnosticsT(
                result?.diagnostics?.mode === "legacy" ? "legacyMatches" : "finalMatches",
              )}
            </h3>
            <div className="mt-4 space-y-3">
              {result?.topMatches.length ? (
                result.topMatches.map((match, index) => (
                  <div
                    key={`${match.assetLogoId}-${index}`}
                    className={cn(
                      "rounded-[18px] border px-4 py-3",
                      index === 0 ? "border-warning-4 bg-warning-1" : "border-basic-3 bg-basic-1",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-basic-8">{match.logoName}</div>
                      <div className="text-sm text-basic-5">#{index + 1}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-basic-5">
                      {diagnosticsT("retrievalSimilarity")} {formatPercent(match.similarity)} ·{" "}
                      {diagnosticsT(
                        result?.diagnostics?.mode === "legacy"
                          ? "legacyConfidence"
                          : "llmConfidence",
                      )}{" "}
                      {match.confidence}
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
                        ? "border-warning-4 bg-warning-1"
                        : "border-basic-3 bg-basic-1",
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
      <FeatureDecisionComparison runs={runs} />
      {result?.diagnostics ? (
        <FeatureDecisionDiagnosticsPanel diagnostics={result.diagnostics} />
      ) : null}
    </div>
  );
}
