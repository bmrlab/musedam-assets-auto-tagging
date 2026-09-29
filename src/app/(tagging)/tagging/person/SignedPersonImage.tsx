/* eslint-disable @next/next/no-img-element */
"use client";

import type { ImgHTMLAttributes } from "react";
import { useSignedAssetPersonImageQuery } from "./useSignedAssetPersonImageQuery";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedPersonImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

export default function SignedPersonImage({
  imageId,
  signedUrl,
  signedUrlExpiresAt,
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

  return (
    <img
      // 列表里是几十张参考图原图（~1000px）当小缩略图显示：默认懒加载、异步解码，
      // 避免首屏一次性下载、解码全部原图（React 也不会再为它们生成 preload）
      loading="lazy"
      decoding="async"
      {...props}
      alt={props.alt ?? ""}
      src={currentSignedUrl}
      onError={(event) => {
        props.onError?.(event);
        if (Date.now() >= currentExpiresAt - REFRESH_BUFFER_MS) {
          void refreshSignedUrl();
        }
      }}
    />
  );
}
