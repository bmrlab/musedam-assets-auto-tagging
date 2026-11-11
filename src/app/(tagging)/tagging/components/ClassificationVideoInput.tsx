/* eslint-disable @next/next/no-img-element */
"use client";

import { Button } from "@/components/ui/button";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { uploadS3ObjectFromBrowser } from "@/lib/s3-browser-upload";
import { FolderOpen, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CLASSIFICATION_VIDEO_UPLOAD_LIMIT,
  CLASSIFICATION_VIDEO_UPLOAD_LIMIT_MB,
  getVideoExtension,
  type ClassificationVideoSource,
} from "./classification-video";
import {
  importClassificationVideoAction,
  prepareClassificationVideoUploadAction,
} from "./classification-video-actions";

type VideoPreview = { name: string; url: string; thumbnail?: string };
type SelectedVideo = VideoPreview &
  ({ kind: "local"; file: File } | { kind: "musedam"; assetId: string });

function assetIdString(id: unknown) {
  if (id && typeof id === "object" && "value" in id) return String(id.value);
  return String(id ?? "");
}

export function useClassificationVideo() {
  const t = useTranslations();
  const [video, setVideo] = useState<SelectedVideo | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const uploaded = useRef<{ file: File; objectKey: string } | null>(null);

  useEffect(() => {
    return () => {
      if (video?.kind === "local") URL.revokeObjectURL(video.url);
    };
  }, [video]);

  function clearVideo() {
    uploaded.current = null;
    setVideo(null);
  }

  function selectLocalVideo(file: File) {
    if (!file.size || file.size > CLASSIFICATION_VIDEO_UPLOAD_LIMIT) {
      toast.error(
        t.has("Tagging.ClassificationVideo.uploadLimit")
          ? t("Tagging.ClassificationVideo.uploadLimit", {
              size: CLASSIFICATION_VIDEO_UPLOAD_LIMIT_MB,
            })
          : `Select a video up to ${CLASSIFICATION_VIDEO_UPLOAD_LIMIT_MB} MB.`,
      );
      return;
    }
    setVideo({ kind: "local", name: file.name, url: URL.createObjectURL(file), file });
  }

  async function importVideo(onSelected: (name: string, folder: string) => void) {
    setIsImporting(true);
    try {
      const selection = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
      if (!selection?.selectedAssets?.length) return;
      const asset = selection.selectedAssets.find(({ name, extension }) =>
        getVideoExtension(name, extension),
      );
      if (!asset) {
        toast.error(
          t.has("Tagging.ClassificationVideo.selectVideo")
            ? t("Tagging.ClassificationVideo.selectVideo")
            : "Select a supported video from MuseDAM.",
        );
        return;
      }
      const assetId = assetIdString(asset.id);
      const result = await importClassificationVideoAction(assetId);
      if (!result.success) throw new Error(result.message);
      onSelected(result.data.name, asset.folderName ?? "");
      uploaded.current = null;
      setVideo({ kind: "musedam", assetId, ...result.data });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import video from MuseDAM.");
    } finally {
      setIsImporting(false);
    }
  }

  async function getVideoSource(): Promise<ClassificationVideoSource> {
    if (!video) throw new Error("Select a video first.");
    if (video.kind === "musedam") return { kind: "musedam", assetId: video.assetId };
    if (uploaded.current?.file === video.file) {
      return { kind: "local", objectKey: uploaded.current.objectKey };
    }
    const prepared = await prepareClassificationVideoUploadAction({
      name: video.file.name,
      mimeType: video.file.type,
      size: video.file.size,
    });
    if (!prepared.success) throw new Error(prepared.message);
    const { objectKey, uploadUrl, contentType } = prepared.data;
    const response = await uploadS3ObjectFromBrowser({ uploadUrl, file: video.file, contentType });
    if (!response.ok)
      throw new Error(
        t.has("Tagging.ClassificationVideo.uploadFailed")
          ? t("Tagging.ClassificationVideo.uploadFailed")
          : "Could not upload video.",
      );
    uploaded.current = { file: video.file, objectKey };
    return { kind: "local", objectKey };
  }

  return { video, clearVideo, selectLocalVideo, importVideo, isImporting, getVideoSource };
}

export function ImportClassificationVideoButton({
  disabled,
  isImporting,
  onClick,
}: {
  disabled: boolean;
  isImporting: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("Tagging.Test");
  return (
    <Button type="button" variant="outline" disabled={disabled || isImporting} onClick={onClick}>
      {isImporting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FolderOpen className="size-4" />
      )}
      {t("selectAssetsFromLibrary")}
    </Button>
  );
}

export function ClassificationVideoPreview({ video }: { video: VideoPreview }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2">
      {failed ? (
        video.thumbnail && (
          <img
            src={video.thumbnail}
            alt=""
            className="max-h-[420px] max-w-full rounded-xl object-contain"
          />
        )
      ) : (
        <video
          controls
          playsInline
          preload="metadata"
          src={video.url}
          poster={video.thumbnail}
          aria-label={video.name}
          onError={() => setFailed(true)}
          className="max-h-[480px] max-w-full rounded-xl bg-black"
        />
      )}
      <p className="max-w-full truncate text-sm text-basic-6" title={video.name}>
        {video.name}
      </p>
    </div>
  );
}

export function ClassificationMediaHint() {
  const t = useTranslations();
  return (
    <p>
      {t.has("Tagging.ClassificationVideo.uploadHint")
        ? t("Tagging.ClassificationVideo.uploadHint")
        : "Upload an image or video, or select a video from MuseDAM."}
    </p>
  );
}
