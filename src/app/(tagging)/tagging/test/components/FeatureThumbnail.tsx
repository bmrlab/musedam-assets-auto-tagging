/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { getFeatureThumbnailAction } from "./actions";

type FeatureType = "brand" | "ip" | "product" | "person";

type FeatureThumbnailProps = {
  featureType: FeatureType;
  featureId: string;
  alt: string;
  className?: string;
};

const REFRESH_BUFFER_MS = 60 * 1000;

export function FeatureThumbnail({ featureType, featureId, alt, className }: FeatureThumbnailProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const fetchThumbnail = async () => {
    try {
      setIsLoading(true);
      setHasError(false);
      const result = await getFeatureThumbnailAction(featureType, featureId);

      if (result.success && result.data) {
        setImageUrl(result.data.signedUrl);
        setExpiresAt(result.data.signedUrlExpiresAt);
      } else {
        setHasError(true);
      }
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchThumbnail();
  }, [featureType, featureId]);

  // Auto-refresh before expiration
  useEffect(() => {
    if (!expiresAt || hasError) return;

    const now = Date.now();
    const timeUntilRefresh = Math.max(expiresAt - now - REFRESH_BUFFER_MS, 0);

    const timeoutId = window.setTimeout(() => {
      fetchThumbnail();
    }, timeUntilRefresh);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [expiresAt, hasError]);

  if (isLoading) {
    return (
      <div className={`${className} bg-basic-2 animate-pulse`}>
        <div className="h-full w-full bg-basic-3/50" />
      </div>
    );
  }

  if (hasError || !imageUrl) {
    return (
      <div className={`${className} bg-basic-2 flex items-center justify-center`}>
        <svg
          className="w-1/2 h-1/2 text-basic-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt}
      className={`${className} object-cover`}
      onError={() => {
        // If URL expired, refresh it
        if (Date.now() >= expiresAt - REFRESH_BUFFER_MS) {
          fetchThumbnail();
        } else {
          setHasError(true);
        }
      }}
    />
  );
}
