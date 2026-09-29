/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { useSignedAssetPersonImageQuery } from "./useSignedAssetPersonImageQuery";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedPersonImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  /** 缩略图地址：优先显示，加载失败（还没生成 / 已过期）时退回原图 */
  thumbnailUrl?: string;
};

export default function SignedPersonImage({
  imageId,
  signedUrl,
  signedUrlExpiresAt,
  thumbnailUrl,
  ...props
}: SignedPersonImageProps) {
  const {
    signedUrl: currentSignedUrl,
    signedUrlExpiresAt: currentExpiresAt,
    refreshSignedUrl,
  } = useSignedAssetPersonImageQuery({
    imageId,
    signedUrl,
    signedUrlExpiresAt,
  });
  const [showThumbnail, setShowThumbnail] = useState(Boolean(thumbnailUrl));
  useEffect(() => {
    setShowThumbnail(Boolean(thumbnailUrl));
  }, [imageId, thumbnailUrl]);

  return (
    <img
      // 列表里是几十张参考图原图（~1000px）当小缩略图显示：默认懒加载、异步解码，
      // 避免首屏一次性下载、解码全部原图（React 也不会再为它们生成 preload）
      loading="lazy"
      decoding="async"
      {...props}
      alt={props.alt ?? ""}
      src={showThumbnail && thumbnailUrl ? thumbnailUrl : currentSignedUrl}
      onError={(event) => {
        if (showThumbnail) {
          // 缩略图还没生成或已过期：退回原图，原图再失败才走下面的签名刷新
          setShowThumbnail(false);
          return;
        }
        props.onError?.(event);
        if (Date.now() >= currentExpiresAt - REFRESH_BUFFER_MS) {
          void refreshSignedUrl();
        }
      }}
    />
  );
}
