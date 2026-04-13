"use client";

import { useCallback, useEffect, useState } from "react";
import { refreshAssetLogoImageSignedUrlAction } from "./actions";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedAssetLogoImageSeed = {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type SignedAssetLogoImageSnapshot = {
  signedUrl: string;
  signedUrlExpiresAt: number;
  isRefreshing: boolean;
};

type SignedAssetLogoImageCacheEntry = SignedAssetLogoImageSnapshot & {
  refreshPromise: Promise<SignedAssetLogoImageSnapshot | null> | null;
  listeners: Set<(snapshot: SignedAssetLogoImageSnapshot) => void>;
};

const signedAssetLogoImageCache = new Map<string, SignedAssetLogoImageCacheEntry>();

function buildSnapshot(entry: SignedAssetLogoImageCacheEntry): SignedAssetLogoImageSnapshot {
  return {
    signedUrl: entry.signedUrl,
    signedUrlExpiresAt: entry.signedUrlExpiresAt,
    isRefreshing: entry.isRefreshing,
  };
}

function shouldReplaceSignedAssetLogoImageSeed(
  entry: SignedAssetLogoImageCacheEntry,
  seed: SignedAssetLogoImageSeed,
) {
  if (seed.signedUrlExpiresAt > entry.signedUrlExpiresAt) {
    return true;
  }

  return seed.signedUrlExpiresAt === entry.signedUrlExpiresAt && seed.signedUrl !== entry.signedUrl;
}

function ensureSignedAssetLogoImageCacheEntry(seed: SignedAssetLogoImageSeed) {
  const existingEntry = signedAssetLogoImageCache.get(seed.imageId);

  if (!existingEntry) {
    const nextEntry: SignedAssetLogoImageCacheEntry = {
      signedUrl: seed.signedUrl,
      signedUrlExpiresAt: seed.signedUrlExpiresAt,
      isRefreshing: false,
      refreshPromise: null,
      listeners: new Set(),
    };

    signedAssetLogoImageCache.set(seed.imageId, nextEntry);
    return nextEntry;
  }

  if (shouldReplaceSignedAssetLogoImageSeed(existingEntry, seed)) {
    existingEntry.signedUrl = seed.signedUrl;
    existingEntry.signedUrlExpiresAt = seed.signedUrlExpiresAt;
  }

  return existingEntry;
}

function emitSignedAssetLogoImageSnapshot(entry: SignedAssetLogoImageCacheEntry) {
  const snapshot = buildSnapshot(entry);
  for (const listener of entry.listeners) {
    listener(snapshot);
  }
}

async function refreshSignedAssetLogoImageQuery(imageId: string) {
  const entry = signedAssetLogoImageCache.get(imageId);
  if (!entry) {
    return null;
  }

  if (entry.refreshPromise) {
    return entry.refreshPromise;
  }

  entry.isRefreshing = true;
  emitSignedAssetLogoImageSnapshot(entry);

  entry.refreshPromise = (async () => {
    const result = await refreshAssetLogoImageSignedUrlAction(imageId);

    if (result.success) {
      entry.signedUrl = result.data.signedUrl;
      entry.signedUrlExpiresAt = result.data.signedUrlExpiresAt;
    }

    return buildSnapshot(entry);
  })()
    .catch(() => buildSnapshot(entry))
    .finally(() => {
      entry.isRefreshing = false;
      entry.refreshPromise = null;
      emitSignedAssetLogoImageSnapshot(entry);
    });

  return entry.refreshPromise;
}

function subscribeSignedAssetLogoImage(
  seed: SignedAssetLogoImageSeed,
  listener: (snapshot: SignedAssetLogoImageSnapshot) => void,
) {
  const entry = ensureSignedAssetLogoImageCacheEntry(seed);
  entry.listeners.add(listener);
  listener(buildSnapshot(entry));

  return () => {
    entry.listeners.delete(listener);
  };
}

export function useSignedAssetLogoImageQuery(seed: SignedAssetLogoImageSeed) {
  const { imageId, signedUrl, signedUrlExpiresAt } = seed;
  const [snapshot, setSnapshot] = useState<SignedAssetLogoImageSnapshot>(() =>
    buildSnapshot(ensureSignedAssetLogoImageCacheEntry(seed)),
  );

  useEffect(() => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetLogoImageCacheEntry(nextSeed);
    setSnapshot(buildSnapshot(entry));

    return subscribeSignedAssetLogoImage(nextSeed, setSnapshot);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  const refreshSignedUrl = useCallback(async () => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetLogoImageCacheEntry(nextSeed);
    return (await refreshSignedAssetLogoImageQuery(imageId)) ?? buildSnapshot(entry);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  useEffect(() => {
    const now = Date.now();

    if (snapshot.signedUrlExpiresAt <= now + REFRESH_BUFFER_MS) {
      void refreshSignedUrl();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshSignedUrl();
    }, Math.max(snapshot.signedUrlExpiresAt - now - REFRESH_BUFFER_MS, 0));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [refreshSignedUrl, snapshot.signedUrlExpiresAt]);

  return {
    signedUrl: snapshot.signedUrl,
    signedUrlExpiresAt: snapshot.signedUrlExpiresAt,
    isRefreshing: snapshot.isRefreshing,
    refreshSignedUrl,
  };
}
