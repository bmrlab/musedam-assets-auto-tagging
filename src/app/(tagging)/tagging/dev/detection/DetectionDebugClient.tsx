/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLIENT_IMAGE_PREPARATION_ERROR_CODES,
  getClientImagePreparationErrorCode,
  prepareClientImageUpload,
} from "@/lib/brand/browser-image";
import { ArrowLeft, Loader2, Search, Upload } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { detectLogoBoxesAction, prepareDetectionImageUploadAction } from "./actions";
import { DetectionBox, DetectionUploadResult } from "./types";

type DetectionImageMeta = {
  width: number;
  height: number;
};

function revokeUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getUploadErrorMessage(error: unknown) {
  switch (getClientImagePreparationErrorCode(error)) {
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.fileTooLarge:
      return "The image is too large to upload.";
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.imageLoadFailed:
      return "Failed to load the selected image.";
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionTargetUnreachable:
      return "The image could not be compressed enough for upload.";
    case CLIENT_IMAGE_PREPARATION_ERROR_CODES.compressionFailed:
      return "Failed to compress the selected image.";
    default:
      return error instanceof Error ? error.message : "Failed to process the selected image.";
  }
}

function clampBox(box: DetectionBox, meta: DetectionImageMeta) {
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

function getDetectionLabelPosition(box: DetectionBox, meta: DetectionImageMeta) {
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = src;
  });
}

export default function DetectionDebugClient() {
  const [detectionLabelText, setDetectionLabelText] = useState("logo");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<DetectionImageMeta | null>(null);
  const [result, setResult] = useState<DetectionUploadResult | null>(null);
  const [detections, setDetections] = useState<DetectionBox[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    return () => {
      revokeUrl(previewUrl);
    };
  }, [previewUrl]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = "";

    setResult(null);
    setDetections([]);
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
      toast.error(getUploadErrorMessage(error));
    }
  }

  async function handleDetect() {
    if (!file || !previewUrl || !imageMeta) {
      toast.error("Upload an image before running detection.");
      return;
    }

    const normalizedDetectionLabelText = detectionLabelText.trim();
    if (!normalizedDetectionLabelText) {
      toast.error("Enter detection label text before running detection.");
      return;
    }

    setIsRunning(true);
    setResult(null);
    setDetections([]);

    try {
      const contentType = file.type || "application/octet-stream";
      const uploadPrepareResult = await prepareDetectionImageUploadAction({
        name: file.name,
        mimeType: contentType,
        size: file.size,
      });
      if (!uploadPrepareResult.success) {
        toast.error(uploadPrepareResult.message);
        return;
      }

      const uploadResponse = await fetch(uploadPrepareResult.data.image.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": uploadPrepareResult.data.image.mimeType,
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        toast.error("Failed to upload the selected image.");
        return;
      }

      const detectionResult = await detectLogoBoxesAction({
        objectKey: uploadPrepareResult.data.image.objectKey,
        detectionLabelText: normalizedDetectionLabelText,
      });
      if (!detectionResult.success) {
        toast.error(detectionResult.message);
        return;
      }

      const normalizedBoxes = detectionResult.data.detections.map((box) =>
        clampBox(box, imageMeta),
      );
      setResult(detectionResult.data);
      setDetections(normalizedBoxes);
      toast.success(
        normalizedBoxes.length > 0
          ? `Detection complete. Found ${normalizedBoxes.length} box${normalizedBoxes.length === 1 ? "" : "es"}.`
          : "Detection complete. No boxes found.",
      );
    } catch (error) {
      console.error("Failed to run logo detection:", error);
      toast.error(error instanceof Error ? error.message : "Detection failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 px-1 py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-basic-5">
            <Link
              href="/tagging/brand"
              className="inline-flex items-center gap-1 hover:text-basic-8"
            >
              <ArrowLeft className="size-4" />
              Back to brand library
            </Link>
          </div>
          <h2 className="mt-3 text-[28px] leading-[40px] font-semibold text-basic-8">
            Detection Service Debug
          </h2>
          <p className="mt-1 text-sm leading-6 text-basic-5">
            Test LOGO_DETECTION_SERVER_URL with a local image and custom detection_label_text. The
            server appends <code className="text-basic-8"> .</code> when missing so Grounding DINO
            returns boxes reliably.
          </p>
        </div>

        <div className="rounded-[18px] border bg-background px-5 py-4 text-right">
          <div className="text-sm text-basic-5">Detection boxes</div>
          <div className="mt-1 text-3xl font-semibold text-basic-8">{detections.length}</div>
          <div className="mt-1 text-xs text-basic-5">
            {result
              ? result.found
                ? "Service returned found=true"
                : "Service returned found=false"
              : "Not run yet"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <div className="space-y-6 rounded-[24px] border bg-background p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(240px,320px)_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="detection-label-text">detection_label_text</Label>
              <Input
                id="detection-label-text"
                value={detectionLabelText}
                onChange={(event) => {
                  setDetectionLabelText(event.target.value);
                  setResult(null);
                  setDetections([]);
                }}
                placeholder="logo . brand logo . emblem"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="detection-image">Image</Label>
              <Input
                id="detection-image"
                type="file"
                accept="image/*,.svg"
                onChange={handleFileChange}
              />
            </div>

            <Button
              type="button"
              onClick={handleDetect}
              disabled={isRunning || !file || !detectionLabelText.trim()}
              className="lg:mb-px"
            >
              {isRunning ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Detecting
                </>
              ) : (
                <>
                  <Search className="size-4" />
                  Detect
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
                      alt="Image to detect"
                      className="block h-auto max-h-[720px] max-w-full"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0">
                    {detections.map((box, index) => {
                      const left = (box.xMin / imageMeta.width) * 100;
                      const top = (box.yMin / imageMeta.height) * 100;
                      const width = ((box.xMax - box.xMin) / imageMeta.width) * 100;
                      const height = ((box.yMax - box.yMin) / imageMeta.height) * 100;
                      const labelPosition = getDetectionLabelPosition(box, imageMeta);

                      return (
                        <Fragment key={`${box.label}-${index}`}>
                          <div
                            className="absolute rounded-[14px] border-2 border-[#3370ff]/80 bg-[rgba(51,112,255,0.10)]"
                            style={{
                              left: `${left}%`,
                              top: `${top}%`,
                              width: `${width}%`,
                              height: `${height}%`,
                            }}
                          />
                          <span
                            className="absolute z-10 overflow-hidden text-ellipsis rounded-full bg-[#3370ff] px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-sm"
                            style={labelPosition}
                          >
                            Box {index + 1} · {box.label} · {formatPercent(box.score)}
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
                <p>Upload an image to preview detection boxes.</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">Run Details</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-basic-5">
              <div>
                <div className="font-medium text-basic-8">Label text</div>
                <div className="mt-1 break-words rounded-[12px] bg-[#f6f8fb] px-3 py-2">
                  {result?.detectionLabelText || detectionLabelText || "Not set"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[12px] bg-[#f6f8fb] px-3 py-2">
                  <div className="text-xs text-basic-5">Image</div>
                  <div className="font-medium text-basic-8">
                    {imageMeta ? `${imageMeta.width} x ${imageMeta.height}` : "None"}
                  </div>
                </div>
                <div className="rounded-[12px] bg-[#f6f8fb] px-3 py-2">
                  <div className="text-xs text-basic-5">Found</div>
                  <div className="font-medium text-basic-8">
                    {result ? String(result.found) : "Not run"}
                  </div>
                </div>
              </div>

              {result?.signedUrl ? (
                <a
                  href={result.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-[#3366ff] hover:underline"
                >
                  Open signed image URL
                </a>
              ) : null}
            </div>
          </div>

          <div className="rounded-[24px] border bg-background p-6">
            <h3 className="text-lg font-semibold text-basic-8">Detection Boxes</h3>
            <div className="mt-4 space-y-3">
              {detections.length > 0 ? (
                detections.map((box, index) => (
                  <div
                    key={`${box.label}-${index}-meta`}
                    className="rounded-[16px] border border-[#d9e2f2] bg-[#fafcff] px-4 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-basic-8">
                        Box {index + 1} · {box.label}
                      </div>
                      <div className="text-basic-8">Confidence {formatPercent(box.score)}</div>
                    </div>
                    <div className="mt-1 leading-6 text-basic-5">
                      ({Math.round(box.xMin)}, {Math.round(box.yMin)}) to ({Math.round(box.xMax)},{" "}
                      {Math.round(box.yMax)})
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-basic-5">
                  {result
                    ? "No detection data returned."
                    : "Run detection to see boxes and confidences."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
