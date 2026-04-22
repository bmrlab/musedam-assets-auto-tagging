/* eslint-disable @next/next/no-img-element */
"use client";

import type { ImgHTMLAttributes } from "react";
import { useSignedAssetIpImageQuery } from "./useSignedAssetIpImageQuery";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedIpImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

export default function SignedIpImage({
  imageId,
  signedUrl,
  signedUrlExpiresAt,
  ...props
}: SignedIpImageProps) {
  const {
    signedUrl: currentSignedUrl,
    signedUrlExpiresAt: currentExpiresAt,
    refreshSignedUrl,
  } = useSignedAssetIpImageQuery({
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
