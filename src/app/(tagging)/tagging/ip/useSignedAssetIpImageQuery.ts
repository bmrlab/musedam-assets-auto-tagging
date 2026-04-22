"use client";

import { useCallback, useEffect, useState } from "react";
import { refreshAssetIpImageSignedUrlAction } from "./actions";

const REFRESH_BUFFER_MS = 60 * 1000;

type SignedAssetIpImageSeed = {
  imageId: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
};

type SignedAssetIpImageSnapshot = {
  signedUrl: string;
  signedUrlExpiresAt: number;
  isRefreshing: boolean;
};

type SignedAssetIpImageCacheEntry = SignedAssetIpImageSnapshot & {
  refreshPromise: Promise<SignedAssetIpImageSnapshot | null> | null;
  listeners: Set<(snapshot: SignedAssetIpImageSnapshot) => void>;
};

const signedAssetIpImageCache = new Map<string, SignedAssetIpImageCacheEntry>();

function buildSnapshot(entry: SignedAssetIpImageCacheEntry): SignedAssetIpImageSnapshot {
  return {
    signedUrl: entry.signedUrl,
    signedUrlExpiresAt: entry.signedUrlExpiresAt,
    isRefreshing: entry.isRefreshing,
  };
}

function shouldReplaceSignedAssetIpImageSeed(
  entry: SignedAssetIpImageCacheEntry,
  seed: SignedAssetIpImageSeed,
) {
  if (seed.signedUrlExpiresAt > entry.signedUrlExpiresAt) {
    return true;
  }

  return seed.signedUrlExpiresAt === entry.signedUrlExpiresAt && seed.signedUrl !== entry.signedUrl;
}

function ensureSignedAssetIpImageCacheEntry(seed: SignedAssetIpImageSeed) {
  const existingEntry = signedAssetIpImageCache.get(seed.imageId);

  if (!existingEntry) {
    const nextEntry: SignedAssetIpImageCacheEntry = {
      signedUrl: seed.signedUrl,
      signedUrlExpiresAt: seed.signedUrlExpiresAt,
      isRefreshing: false,
      refreshPromise: null,
      listeners: new Set(),
    };

    signedAssetIpImageCache.set(seed.imageId, nextEntry);
    return nextEntry;
  }

  if (shouldReplaceSignedAssetIpImageSeed(existingEntry, seed)) {
    existingEntry.signedUrl = seed.signedUrl;
    existingEntry.signedUrlExpiresAt = seed.signedUrlExpiresAt;
  }

  return existingEntry;
}

function emitSignedAssetIpImageSnapshot(entry: SignedAssetIpImageCacheEntry) {
  const snapshot = buildSnapshot(entry);
  for (const listener of entry.listeners) {
    listener(snapshot);
  }
}

async function refreshSignedAssetIpImageQuery(imageId: string) {
  const entry = signedAssetIpImageCache.get(imageId);
  if (!entry) {
    return null;
  }

  if (entry.refreshPromise) {
    return entry.refreshPromise;
  }

  entry.isRefreshing = true;
  emitSignedAssetIpImageSnapshot(entry);

  entry.refreshPromise = (async () => {
    const result = await refreshAssetIpImageSignedUrlAction(imageId);

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
      emitSignedAssetIpImageSnapshot(entry);
    });

  return entry.refreshPromise;
}

function subscribeSignedAssetIpImage(
  seed: SignedAssetIpImageSeed,
  listener: (snapshot: SignedAssetIpImageSnapshot) => void,
) {
  const entry = ensureSignedAssetIpImageCacheEntry(seed);
  entry.listeners.add(listener);
  listener(buildSnapshot(entry));

  return () => {
    entry.listeners.delete(listener);
  };
}

export function useSignedAssetIpImageQuery(seed: SignedAssetIpImageSeed) {
  const { imageId, signedUrl, signedUrlExpiresAt } = seed;
  const [snapshot, setSnapshot] = useState<SignedAssetIpImageSnapshot>(() =>
    buildSnapshot(ensureSignedAssetIpImageCacheEntry(seed)),
  );

  useEffect(() => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetIpImageCacheEntry(nextSeed);
    setSnapshot(buildSnapshot(entry));

    return subscribeSignedAssetIpImage(nextSeed, setSnapshot);
  }, [imageId, signedUrl, signedUrlExpiresAt]);

  const refreshSignedUrl = useCallback(async () => {
    const nextSeed = {
      imageId,
      signedUrl,
      signedUrlExpiresAt,
    };
    const entry = ensureSignedAssetIpImageCacheEntry(nextSeed);
    return (await refreshSignedAssetIpImageQuery(imageId)) ?? buildSnapshot(entry);
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
