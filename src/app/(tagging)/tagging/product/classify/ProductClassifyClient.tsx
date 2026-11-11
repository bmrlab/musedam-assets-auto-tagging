/* eslint-disable @next/next/no-img-element */
"use client";

import {
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
  classifyProductImageAction,
  prepareProductClassificationAction,
  prepareProductImageUploadAction,
} from "../actions";
import { ProductClassificationResult, ProductDetectionBox, ProductLibraryPageData } from "../types";

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

function getFallbackBox(
  meta: ClassificationImageMeta,
  t: TranslationFunction,
): ProductDetectionBox {
  return {
    xMin: 0,
    yMin: 0,
    xMax: meta.width,
    yMax: meta.height,
    score: 1,
    label: t("fallbackBox"),
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

export default function ProductClassifyClient({
  initialData,
}: {
  initialData: ProductLibraryPageData;
}) {
  const t = useTranslations("Tagging.ProductClassify") as TranslationFunction;
  const diagnosticsT = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const referenceProducts = useMemo(
    () =>
      initialData.products.filter((product) => product.enabled && product.status === "completed"),
    [initialData.products],
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
  const [detections, setDetections] = useState<ProductDetectionBox[]>([]);
  const [result, setResult] = useState<ProductClassificationResult | null>(null);
  const [showRawDetections, setShowRawDetections] = useState(false);
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
    setShowRawDetections(false);
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
      const nextFile = await prepareClientImageUpload(selectedFile, { preserveOriginal: true });
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
    if (!video && (!file || !previewUrl || !imageMeta)) {
      toast.error(t("uploadImageFirst"));
      return;
    }

    if (referenceProducts.length === 0) {
      toast.error(t("noReferenceProducts"));
      return;
    }

    setIsRunning(true);
    setResult(null);
    setShowRawDetections(false);
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
            name: match.productName,
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
      console.error("Failed to classify Product image:", error);
      toast.error(error instanceof Error ? error.message : t("classifyFailed"));
    } finally {
      setIsRunning(false);
    }
  }

  async function classifySelectedVideo(): ReturnType<typeof classifyProductImageAction> {
    const response = await classifyFeatureVideoAction({
      source: await getVideoSource(),
      featureType: "product",
      imageMode,
      fileName,
      folderPath,
    });
    if (!response.success) return response;
    const result = response.data.product;
    if (!result) return { success: false, message: t("classifyFailed") };
    return { success: true, data: { result } };
  }

  async function classifySelectedImage(file: File) {
    const contentType = file.type || "application/octet-stream";
    const uploadPrepareResult = await prepareProductImageUploadAction({
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

    const prepareResult = await prepareProductClassificationAction({
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
        : [getFallbackBox(nextDetectionImageMeta, t)];

    setDetectionImageMeta(nextDetectionImageMeta);
    setDetections(candidateBoxes);

    return classifyProductImageAction({
      objectKey: uploadPrepareResult.data.image.objectKey,
      mimeType: uploadPrepareResult.data.image.mimeType,
      size: uploadPrepareResult.data.image.size,
      imageMode,
      fileName,
      folderPath,
      boxes: candidateBoxes,
    });
  }

  const boxImageMeta = detectionImageMeta ?? imageMeta;
  const acceptedMatches = result?.matches ?? [];
  const acceptedProductsByDetection = new Map(
    acceptedMatches.flatMap((match) =>
      match.detectionIndices.map((index) => [index, match] as const),
    ),
  );
  const rawDetections = result?.rawDetections ?? detections;
  const detectionRows = result
    ? result.detections.map((detection, regionIndex) => ({
        box: detection.box,
        detectionIndex: detection.detectionIndex,
        sourceDetectionIndices: detection.sourceDetectionIndices ?? [detection.detectionIndex],
        regionIndex,
        detectionResult: detection,
      }))
    : rawDetections.map((box, detectionIndex) => ({
        box,
        detectionIndex,
        sourceDetectionIndices: [detectionIndex],
        regionIndex: null,
        detectionResult: null,
      }));
  const overlayBoxes =
    !result || showRawDetections
      ? rawDetections.map((box, detectionIndex) => ({
          box,
          detectionIndex,
          regionIndex: null,
        }))
      : detectionRows;
  const bestMatchRegionIndex =
    result?.detections.findIndex(
      (detection) => detection.detectionIndex === result.bestMatch?.detectionIndex,
    ) ?? -1;

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 px-1 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-basic-5">
            <Link
              href="/tagging/product"
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
          <div className="text-sm text-basic-5">{t("availableProducts")}</div>
          <div className="mt-1 text-3xl font-semibold text-basic-8">{referenceProducts.length}</div>
          <div className="mt-1 text-xs text-basic-5">{t("statsDescription")}</div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
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
                isRunning || isImporting || (!file && !video) || referenceProducts.length === 0
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

          {result && !video ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-basic-5">
              <p>
                {t("productRegions")}: {result.detections.length} · {t("rawDetectionBoxes")}:{" "}
                {rawDetections.length}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={showRawDetections}
                onClick={() => setShowRawDetections((current) => !current)}
              >
                {t(showRawDetections ? "showProductRegions" : "showRawDetections")}
              </Button>
            </div>
          ) : null}

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
                    alt={t("imageToClassify")}
                    className="block h-full w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {overlayBoxes.map(({ box, detectionIndex, regionIndex }) => {
                      const acceptedProduct = acceptedProductsByDetection.get(detectionIndex);
                      const active = Boolean(acceptedProduct);
                      const boxStyle = getClassificationBoxPercentages(box, boxImageMeta);
                      const labelPosition = getClassificationLabelPosition(box, boxImageMeta);

                      return (
                        <Fragment key={`${box.label}-${detectionIndex}`}>
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
                            {t(regionIndex === null ? "box" : "region")}{" "}
                            {(regionIndex ?? detectionIndex) + 1} ·{" "}
                            {showRawDetections
                              ? box.label
                              : (acceptedProduct?.productName ?? box.label)}
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
              {result ? (
                <span className="text-basic-5">
                  (
                  {result.diagnostics?.mode === "llm"
                    ? result.topMatches.length
                    : acceptedMatches.length}
                  )
                </span>
              ) : null}
            </div>

            {result?.diagnostics?.mode === "llm" &&
            result.diagnostics.decision.status === "completed" ? (
              <FeatureDecisionPredictions
                diagnostics={result.diagnostics}
                names={Object.fromEntries(
                  result.topMatches.map((match) => [
                    `product:${match.assetProductId}`,
                    match.productName,
                  ]),
                )}
                acceptedCandidateIds={(result.matches ?? []).map(
                  (match) => `product:${match.assetProductId}`,
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
                    <div className="font-medium text-basic-8">{result.bestMatch.productName}</div>
                    <div className="mt-1 text-basic-5">
                      {diagnosticsT("retrievalSimilarity")}{" "}
                      {formatPercent(result.bestMatch.similarity)} ·{" "}
                      {diagnosticsT(
                        result?.diagnostics?.mode === "legacy"
                          ? "legacyConfidence"
                          : "llmConfidence",
                      )}{" "}
                      {result.bestMatch.confidence} ·{" "}
                      {t(bestMatchRegionIndex >= 0 ? "region" : "box")}{" "}
                      {(bestMatchRegionIndex >= 0
                        ? bestMatchRegionIndex
                        : result.bestMatch.detectionIndex) + 1}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              acceptedMatches.map((match) => (
                <div
                  key={match.assetProductId}
                  className="mt-4 rounded-[18px] border border-success-4 bg-success-1 p-4"
                >
                  <p className="text-sm text-basic-5">{t("winningProduct")}</p>
                  <p className="mt-2 text-2xl font-semibold text-basic-8">{match.productName}</p>
                  <p className="mt-2 text-sm leading-6 text-basic-5">
                    {t("type")} {match.productTypeName} · {diagnosticsT("retrievalSimilarity")}{" "}
                    {formatPercent(match.similarity)} ·{" "}
                    {diagnosticsT(
                      result?.diagnostics?.mode === "legacy" ? "legacyConfidence" : "llmConfidence",
                    )}{" "}
                    {match.confidence}
                  </p>
                  <p className="mt-1 text-sm text-basic-5">
                    {t("imageSimilarity")} {formatPercent(match.imageSimilarity)} ·{" "}
                    {t("descriptionSimilarity")} {formatPercent(match.descriptionSimilarity)}
                  </p>
                  <p className="mt-1 text-sm text-basic-5">
                    {t("productRegions")}:{" "}
                    {result.detections
                      .flatMap((detection, regionIndex) =>
                        match.detectionIndices.includes(detection.detectionIndex)
                          ? [regionIndex + 1]
                          : [],
                      )
                      .join(", ")}
                  </p>
                  {match.description ? (
                    <p className="mt-3 text-sm leading-6 text-basic-5">{match.description}</p>
                  ) : null}
                  {match.recommendedTags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {match.recommendedTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center rounded-[6px] border border-basic-4 bg-background px-2 py-1 text-xs text-basic-8"
                        >
                          {tag.tagPath.join(" > ")}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">
              {t(result ? "productRegions" : "detectionBoxes")}
            </h3>
            <div className="mt-4 space-y-3">
              {detectionRows.length > 0 ? (
                detectionRows.map(
                  ({
                    box,
                    detectionIndex,
                    sourceDetectionIndices,
                    regionIndex,
                    detectionResult,
                  }) => {
                    return (
                      <div
                        key={`${box.label}-${detectionIndex}-meta`}
                        className={cn(
                          "rounded-[16px] border px-4 py-3 text-sm",
                          acceptedProductsByDetection.has(detectionIndex)
                            ? "border-success-4 bg-success-1"
                            : "border-basic-3 bg-basic-1",
                        )}
                      >
                        <div className="font-medium text-basic-8">
                          {t(regionIndex === null ? "box" : "region")}{" "}
                          {(regionIndex ?? detectionIndex) + 1} · {box.label}
                        </div>
                        <div className="mt-1 leading-6 text-basic-5">
                          ({Math.round(box.xMin)}, {Math.round(box.yMin)}) {t("coordinateTo")} (
                          {Math.round(box.xMax)}, {Math.round(box.yMax)}) · {t("detectorScore")}{" "}
                          {formatPercent(box.score)}
                        </div>
                        {detectionResult ? (
                          <details className="mt-2 text-basic-5">
                            <summary className="cursor-pointer">
                              {t("rawDetectionBoxes")}:{" "}
                              {sourceDetectionIndices.map((index) => index + 1).join(", ")}
                            </summary>
                            <div className="mt-2 space-y-2">
                              {sourceDetectionIndices.map((index) => {
                                const originalBox = rawDetections[index];
                                if (!originalBox) return null;
                                return (
                                  <div
                                    key={index}
                                    className="rounded-[10px] border border-basic-3 bg-background/80 px-3 py-2"
                                  >
                                    <p>
                                      {t("box")} {index + 1} · {originalBox.label}
                                    </p>
                                    <p className="leading-6">
                                      ({Math.round(originalBox.xMin)},{" "}
                                      {Math.round(originalBox.yMin)}) {t("coordinateTo")} (
                                      {Math.round(originalBox.xMax)}, {Math.round(originalBox.yMax)}
                                      ) · {t("detectorScore")} {formatPercent(originalBox.score)}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        ) : null}
                        {detectionResult ? (
                          <div className="mt-3 border-t border-basic-3 pt-3">
                            {detectionResult.noConfidentMatch ? (
                              <p className="mb-2 text-basic-5">{t("noConfidentMatch")}</p>
                            ) : null}
                            <p className="font-medium text-basic-8">
                              {diagnosticsT("retrievalEvidence")}
                            </p>
                            {detectionResult.topMatches.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {detectionResult.topMatches.map((match, rank) => (
                                  <div
                                    key={match.assetProductId}
                                    className="rounded-[10px] border border-basic-3 bg-background/80 px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-3 font-medium text-basic-8">
                                      <span>{match.productName}</span>
                                      <span className="text-basic-5">#{rank + 1}</span>
                                    </div>
                                    <div className="mt-1 leading-6 text-basic-5">
                                      {diagnosticsT("retrievalSimilarity")}{" "}
                                      {formatPercent(match.similarity)}
                                    </div>
                                    <div className="leading-6 text-basic-5">
                                      {t("imageSimilarity")} {formatPercent(match.imageSimilarity)}{" "}
                                      · {t("descriptionSimilarity")}{" "}
                                      {formatPercent(match.descriptionSimilarity)}
                                    </div>
                                    <div className="leading-6 text-basic-5">
                                      {t("type")} {match.productTypeName}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-basic-5">{t("noMatches")}</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  },
                )
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
