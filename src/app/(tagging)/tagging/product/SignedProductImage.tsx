/* eslint-disable @next/next/no-img-element */
"use client";

import type { ImgHTMLAttributes } from "react";
import { useSignedAssetProductImageQuery } from "./useSignedAssetProductImageQuery";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedProductImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

export default function SignedProductImage({
  imageId,
  signedUrl,
  signedUrlExpiresAt,
  ...props
}: SignedProductImageProps) {
  const {
    signedUrl: currentSignedUrl,
    signedUrlExpiresAt: currentExpiresAt,
    refreshSignedUrl,
  } = useSignedAssetProductImageQuery({
    imageId,
    signedUrl,
    signedUrlExpiresAt,
  });

  return (
    <img
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
