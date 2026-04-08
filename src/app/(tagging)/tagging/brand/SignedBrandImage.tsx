/* eslint-disable @next/next/no-img-element */
"use client";

import type { ImgHTMLAttributes } from "react";
import { useSignedAssetLogoImageQuery } from "./useSignedAssetLogoImageQuery";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedBrandImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imageId: number;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

export default function SignedBrandImage({
  imageId,
  signedUrl,
  signedUrlExpiresAt,
  ...props
}: SignedBrandImageProps) {
  const { signedUrl: currentSignedUrl, signedUrlExpiresAt: currentExpiresAt, refreshSignedUrl } =
    useSignedAssetLogoImageQuery({
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
