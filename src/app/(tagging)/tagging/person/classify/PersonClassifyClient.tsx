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
import {
  evaluatePersonMatchCandidates,
  isAcceptedPersonFace,
  PERSON_AUTO_TAG_MIN_RAW_SIMILARITY,
  PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN,
} from "@/lib/person/person-match-policy";
import { uploadS3ObjectFromBrowser } from "@/lib/s3-browser-upload";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Loader2, Search, Trophy, Upload, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  classifyPersonImageAction,
  preparePersonClassificationAction,
  preparePersonImageUploadAction,
} from "../actions";
import {
  PersonClassificationResult,
  PersonDetectionBox,
  PersonFaceClassificationResult,
  PersonLibraryPageData,
} from "../types";

type TranslationFunction = (key: string) => string;

function revokeUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}

function MatchMetric({
  label,
  value,
  requirement,
  passed,
}: {
  label: string;
  value: string;
  requirement?: string;
  passed?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-basic-3 bg-background px-3 py-2.5">
      <div className="text-xs text-basic-5">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-medium text-basic-8">{value}</span>
        {passed === undefined ? null : passed ? (
          <CheckCircle2 className="size-4 shrink-0 text-success-6" />
        ) : (
          <XCircle className="size-4 shrink-0 text-warning-6" />
        )}
      </div>
      {requirement ? <div className="mt-1 text-[11px] text-basic-5">{requirement}</div> : null}
    </div>
  );
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
  const [imageMeta, setImageMeta] = useState<ClassificationImageMeta | null>(null);
  const [detectionImageMeta, setDetectionImageMeta] = useState<ClassificationImageMeta | null>(
    null,
  );
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
    setDetectionImageMeta(null);
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
      const contentType = file.type || "application/octet-stream";
      const uploadPrepareResult = await preparePersonImageUploadAction({
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

      const prepareResult = await preparePersonClassificationAction({
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
      const normalizedBoxes = prepareResult.data.detections.map((box) =>
        clampClassificationBox(box, nextDetectionImageMeta),
      );
      setDetectionImageMeta(nextDetectionImageMeta);
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
          (
            face,
          ): face is { detectionIndex: number; box: PersonDetectionBox; embedding: number[] } =>
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
      const confidentCount = classifyResult.data.result.faces.filter(isAcceptedPersonFace).length;
      toast.success(confidentCount > 0 ? t("classifyComplete") : t("classifyCompleteNoMatch"));
    } catch (error) {
      console.error("Failed to classify person image:", error);
      toast.error(error instanceof Error ? error.message : t("classifyFailed"));
    } finally {
      setIsRunning(false);
    }
  }

  const boxImageMeta = detectionImageMeta ?? imageMeta;

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 px-1 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-basic-5">
            <Link
              href="/tagging/person"
              className="inline-flex items-center gap-1 hover:text-basic-8"
            >
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
          <div className="mt-1 text-3xl font-semibold text-basic-8">{referencePersons.length}</div>
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

          <div className="rounded-[20px] border border-dashed border-basic-3 bg-basic-1 p-4">
            {previewUrl && imageMeta && boxImageMeta ? (
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
                    {detections.map((box, index) => {
                      const faceResult = getFaceResult(result, index);
                      const hasConfidentMatch =
                        Boolean(faceResult?.bestMatch) && !faceResult?.noConfidentMatch;
                      const boxStyle = getClassificationBoxPercentages(box, boxImageMeta);
                      const labelPosition = getClassificationLabelPosition(box, boxImageMeta, 320);
                      const label = faceResult?.bestMatch
                        ? `${faceResult.bestMatch.personName} · ${formatPercent(faceResult.bestMatch.rawSimilarity)}`
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
                              left: `${boxStyle.left}%`,
                              top: `${boxStyle.top}%`,
                              width: `${boxStyle.width}%`,
                              height: `${boxStyle.height}%`,
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
            <div className="mt-3 rounded-[14px] border border-basic-3 bg-basic-1 px-3 py-2 text-xs leading-5 text-basic-5">
              {t("acceptanceRule")}: {t("rawSimilarity")} ≥{" "}
              {formatPercent(PERSON_AUTO_TAG_MIN_RAW_SIMILARITY)} · {t("winnerMargin")} ≥{" "}
              {formatPercent(PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN)}
            </div>

            {!result ? (
              <p className="mt-4 text-sm leading-6 text-basic-5">{t("resultHint")}</p>
            ) : result.faces.length === 0 ? (
              <div className="mt-4 rounded-[18px] border border-warning-4 bg-warning-1 p-4">
                <p className="text-base font-medium text-basic-8">{t("noFacesDetected")}</p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {result.faces.map((face) => {
                  const decision = evaluatePersonMatchCandidates(face.topMatches);
                  const bestMatch = face.bestMatch;
                  const supportBonus = bestMatch
                    ? Math.max(0, bestMatch.similarity - bestMatch.rawSimilarity)
                    : 0;
                  const similarityPassed =
                    decision.bestRawSimilarity !== null &&
                    decision.bestRawSimilarity >= PERSON_AUTO_TAG_MIN_RAW_SIMILARITY;
                  const marginPassed =
                    decision.runnerUpRawSimilarity === null ||
                    (decision.margin !== null &&
                      decision.margin >= PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN);

                  return (
                    <div
                      key={face.detectionIndex}
                      className={cn(
                        "rounded-[18px] border p-4",
                        decision.accepted
                          ? "border-success-4 bg-success-1"
                          : "border-warning-4 bg-warning-1",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-basic-5">
                          {t("face")} {face.detectionIndex + 1}
                        </p>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium",
                            decision.accepted
                              ? "border-success-4 bg-background text-success-7"
                              : "border-warning-4 bg-background text-warning-7",
                          )}
                        >
                          {decision.accepted ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : (
                            <XCircle className="size-3.5" />
                          )}
                          {decision.accepted ? t("autoTagAccepted") : t("autoTagRejected")}
                        </span>
                      </div>
                      {bestMatch ? (
                        <>
                          <p className="mt-2 text-2xl font-semibold text-basic-8">
                            {bestMatch.personName}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-basic-5">
                            {t("type")} {bestMatch.personTypeName}
                          </p>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <MatchMetric
                              label={t("rawSimilarity")}
                              value={formatPercent(bestMatch.rawSimilarity)}
                              requirement={`${t("required")} ≥ ${formatPercent(PERSON_AUTO_TAG_MIN_RAW_SIMILARITY)}`}
                              passed={similarityPassed}
                            />
                            <MatchMetric
                              label={t("winnerMargin")}
                              value={
                                decision.runnerUpRawSimilarity === null
                                  ? t("noRunnerUp")
                                  : formatPercent(decision.margin ?? 0)
                              }
                              requirement={`${t("required")} ≥ ${formatPercent(PERSON_AUTO_TAG_MIN_RUNNER_UP_MARGIN)}`}
                              passed={marginPassed}
                            />
                            <MatchMetric
                              label={t("rankingSimilarity")}
                              value={formatPercent(bestMatch.similarity)}
                            />
                            <MatchMetric
                              label={t("supportBonus")}
                              value={formatSignedPercent(supportBonus)}
                            />
                          </div>

                          <p
                            className={cn(
                              "mt-3 text-sm leading-6",
                              decision.accepted ? "text-success-7" : "text-warning-7",
                            )}
                          >
                            {t(`decisionReasons.${decision.reason}`)}
                          </p>

                          {decision.accepted && bestMatch.recommendedTags.length > 0 ? (
                            <div className="mt-3">
                              <div className="mb-2 text-xs text-basic-5">
                                {t("autoTagCandidates")}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {bestMatch.recommendedTags.map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="inline-flex items-center rounded-[6px] border border-basic-4 bg-background px-2 py-1 text-xs text-basic-8"
                                  >
                                    {tag.tagPath.join(" > ")}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-basic-5">
                          {t("noConfidentMatch")}
                        </p>
                      )}
                    </div>
                  );
                })}
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
                      face.topMatches.map((match, index) => {
                        const supportBonus = Math.max(0, match.similarity - match.rawSimilarity);

                        return (
                          <div
                            key={`${match.assetPersonId}-${face.detectionIndex}-${index}`}
                            className={cn(
                              "rounded-[18px] border px-4 py-3",
                              index === 0 && !face.noConfidentMatch
                                ? "border-success-4 bg-success-1"
                                : index === 0
                                  ? "border-warning-4 bg-warning-1"
                                  : "border-basic-3 bg-basic-1",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium text-basic-8">{match.personName}</div>
                              <div className="text-sm text-basic-5">#{index + 1}</div>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-basic-5">
                              {t("rawSimilarity")} {formatPercent(match.rawSimilarity)}
                              {supportBonus > 0
                                ? ` · ${t("supportBonus")} ${formatSignedPercent(supportBonus)}`
                                : ""}
                            </div>
                            <div className="text-sm leading-6 text-basic-5">
                              {t("rankingSimilarity")} {formatPercent(match.similarity)} ·{" "}
                              {t("type")} {match.personTypeName}
                            </div>
                            <div className="text-sm leading-6 text-basic-5">
                              {t("supportingReferences")} {match.supportingReferenceCount}
                            </div>
                          </div>
                        );
                      })
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
                        ? "border-warning-4 bg-warning-1"
                        : "border-basic-3 bg-basic-1",
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
