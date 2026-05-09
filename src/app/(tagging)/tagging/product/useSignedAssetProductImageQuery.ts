"use client";

import { useCallback, useEffect, useState } from "react";
import { refreshAssetProductImageSignedUrlAction } from "./actions";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedAssetProductImageSeed = {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type SignedAssetProductImageSnapshot = {
  signedUrl: string;
  signedUrlExpiresAt: number;
  isRefreshing: boolean;
};

type SignedAssetProductImageCacheEntry = SignedAssetProductImageSnapshot & {
  refreshPromise: Promise<SignedAssetProductImageSnapshot | null> | null;
  listeners: Set<(snapshot: SignedAssetProductImageSnapshot) => void>;
};

const signedAssetProductImageCache = new Map<string, SignedAssetProductImageCacheEntry>();

function buildSnapshot(entry: SignedAssetProductImageCacheEntry): SignedAssetProductImageSnapshot {
  return {
    signedUrl: entry.signedUrl,
    signedUrlExpiresAt: entry.signedUrlExpiresAt,
    isRefreshing: entry.isRefreshing,
  };
}

function shouldReplaceSignedAssetProductImageSeed(
  entry: SignedAssetProductImageCacheEntry,
  seed: SignedAssetProductImageSeed,
) {
  if (seed.signedUrlExpiresAt > entry.signedUrlExpiresAt) {
    return true;
  }

  return seed.signedUrlExpiresAt === entry.signedUrlExpiresAt && seed.signedUrl !== entry.signedUrl;
}

function ensureSignedAssetProductImageCacheEntry(seed: SignedAssetProductImageSeed) {
  const existingEntry = signedAssetProductImageCache.get(seed.imageId);

  if (!existingEntry) {
    const nextEntry: SignedAssetProductImageCacheEntry = {
      signedUrl: seed.signedUrl,
      signedUrlExpiresAt: seed.signedUrlExpiresAt,
      isRefreshing: false,
      refreshPromise: null,
      listeners: new Set(),
    };

    signedAssetProductImageCache.set(seed.imageId, nextEntry);
    return nextEntry;
  }

  if (shouldReplaceSignedAssetProductImageSeed(existingEntry, seed)) {
    existingEntry.signedUrl = seed.signedUrl;
    existingEntry.signedUrlExpiresAt = seed.signedUrlExpiresAt;
  }

  return existingEntry;
}

function emitSignedAssetProductImageSnapshot(entry: SignedAssetProductImageCacheEntry) {
  const snapshot = buildSnapshot(entry);
  for (const listener of entry.listeners) {
    listener(snapshot);
  }
}

async function refreshSignedAssetProductImageQuery(imageId: string) {
  const entry = signedAssetProductImageCache.get(imageId);
  if (!entry) {
    return null;
  }

  if (entry.refreshPromise) {
    return entry.refreshPromise;
  }

  entry.isRefreshing = true;
  emitSignedAssetProductImageSnapshot(entry);

  entry.refreshPromise = (async () => {
    const result = await refreshAssetProductImageSignedUrlAction(imageId);

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
      emitSignedAssetProductImageSnapshot(entry);
    });

  return entry.refreshPromise;
}

function subscribeSignedAssetProductImage(
  seed: SignedAssetProductImageSeed,
  listener: (snapshot: SignedAssetProductImageSnapshot) => void,
) {
  const entry = ensureSignedAssetProductImageCacheEntry(seed);
  entry.listeners.add(listener);
  listener(buildSnapshot(entry));

  return () => {
    entry.listeners.delete(listener);
  };
}

export function useSignedAssetProductImageQuery(seed: SignedAssetProductImageSeed) {
  const { imageId, signedUrl, signedUrlExpiresAt } = seed;
  const [snapshot, setSnapshot] = useState<SignedAssetProductImageSnapshot>(() =>
    buildSnapshot(ensureSignedAssetProductImageCacheEntry(seed)),
  );

  useEffect(() => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetProductImageCacheEntry(nextSeed);
    setSnapshot(buildSnapshot(entry));

    return subscribeSignedAssetProductImage(nextSeed, setSnapshot);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  const refreshSignedUrl = useCallback(async () => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetProductImageCacheEntry(nextSeed);
    return (await refreshSignedAssetProductImageQuery(imageId)) ?? buildSnapshot(entry);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  useEffect(() => {
    const now = Date.now();

    if (snapshot.signedUrlExpiresAt <= now + REFRESH_BUFFER_MS) {
      void refreshSignedUrl();
      return;
    }

    const timeoutId = window.setTimeout(
      () => {
        void refreshSignedUrl();
      },
      Math.max(snapshot.signedUrlExpiresAt - now - REFRESH_BUFFER_MS, 0),
    );

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
