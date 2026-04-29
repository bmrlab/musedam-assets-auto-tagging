"use client";

import { useCallback, useEffect, useState } from "react";
import { refreshAssetPersonImageSignedUrlAction } from "./actions";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedAssetPersonImageSeed = {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type SignedAssetPersonImageSnapshot = {
  signedUrl: string;
  signedUrlExpiresAt: number;
  isRefreshing: boolean;
};

type SignedAssetPersonImageCacheEntry = SignedAssetPersonImageSnapshot & {
  refreshPromise: Promise<SignedAssetPersonImageSnapshot | null> | null;
  listeners: Set<(snapshot: SignedAssetPersonImageSnapshot) => void>;
};

const signedAssetPersonImageCache = new Map<string, SignedAssetPersonImageCacheEntry>();

function buildSnapshot(entry: SignedAssetPersonImageCacheEntry): SignedAssetPersonImageSnapshot {
  return {
    signedUrl: entry.signedUrl,
    signedUrlExpiresAt: entry.signedUrlExpiresAt,
    isRefreshing: entry.isRefreshing,
  };
}

function shouldReplaceSignedAssetPersonImageSeed(
  entry: SignedAssetPersonImageCacheEntry,
  seed: SignedAssetPersonImageSeed,
) {
  if (seed.signedUrlExpiresAt > entry.signedUrlExpiresAt) {
    return true;
  }

  return seed.signedUrlExpiresAt === entry.signedUrlExpiresAt && seed.signedUrl !== entry.signedUrl;
}

function ensureSignedAssetPersonImageCacheEntry(seed: SignedAssetPersonImageSeed) {
  const existingEntry = signedAssetPersonImageCache.get(seed.imageId);

  if (!existingEntry) {
    const nextEntry: SignedAssetPersonImageCacheEntry = {
      signedUrl: seed.signedUrl,
      signedUrlExpiresAt: seed.signedUrlExpiresAt,
      isRefreshing: false,
      refreshPromise: null,
      listeners: new Set(),
    };

    signedAssetPersonImageCache.set(seed.imageId, nextEntry);
    return nextEntry;
  }

  if (shouldReplaceSignedAssetPersonImageSeed(existingEntry, seed)) {
    existingEntry.signedUrl = seed.signedUrl;
    existingEntry.signedUrlExpiresAt = seed.signedUrlExpiresAt;
  }

  return existingEntry;
}

function emitSignedAssetPersonImageSnapshot(entry: SignedAssetPersonImageCacheEntry) {
  const snapshot = buildSnapshot(entry);
  for (const listener of entry.listeners) {
    listener(snapshot);
  }
}

async function refreshSignedAssetPersonImageQuery(imageId: string) {
  const entry = signedAssetPersonImageCache.get(imageId);
  if (!entry) {
    return null;
  }

  if (entry.refreshPromise) {
    return entry.refreshPromise;
  }

  entry.isRefreshing = true;
  emitSignedAssetPersonImageSnapshot(entry);

  entry.refreshPromise = (async () => {
    const result = await refreshAssetPersonImageSignedUrlAction(imageId);

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
      emitSignedAssetPersonImageSnapshot(entry);
    });

  return entry.refreshPromise;
}

function subscribeSignedAssetPersonImage(
  seed: SignedAssetPersonImageSeed,
  listener: (snapshot: SignedAssetPersonImageSnapshot) => void,
) {
  const entry = ensureSignedAssetPersonImageCacheEntry(seed);
  entry.listeners.add(listener);
  listener(buildSnapshot(entry));

  return () => {
    entry.listeners.delete(listener);
  };
}

export function useSignedAssetPersonImageQuery(seed: SignedAssetPersonImageSeed) {
  const { imageId, signedUrl, signedUrlExpiresAt } = seed;
  const [snapshot, setSnapshot] = useState<SignedAssetPersonImageSnapshot>(() =>
    buildSnapshot(ensureSignedAssetPersonImageCacheEntry(seed)),
  );

  useEffect(() => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetPersonImageCacheEntry(nextSeed);
    setSnapshot(buildSnapshot(entry));

    return subscribeSignedAssetPersonImage(nextSeed, setSnapshot);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  const refreshSignedUrl = useCallback(async () => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetPersonImageCacheEntry(nextSeed);
    return (await refreshSignedAssetPersonImageQuery(imageId)) ?? buildSnapshot(entry);
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
