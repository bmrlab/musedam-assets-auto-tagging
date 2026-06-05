"use client";

import {
  FEATURE_LIBRARY_COOKIE,
  FEATURE_LIBRARY_PARAM,
  FEATURE_LIBRARY_STORAGE_KEY,
  FeatureLibraryValue,
  featureLibraryEnabledToValue,
  isFeatureLibraryValue,
  resolveFeatureLibraryEnabled,
} from "@/lib/feature-library";
import Cookies from "js-cookie";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

function readBrowserFeatureLibraryEnabled() {
  const params = new URLSearchParams(window.location.search);
  const searchValue = params.get(FEATURE_LIBRARY_PARAM);
  const storedValue = window.localStorage.getItem(FEATURE_LIBRARY_STORAGE_KEY);
  const cookieValue = Cookies.get(FEATURE_LIBRARY_COOKIE);

  return resolveFeatureLibraryEnabled(searchValue, storedValue ?? cookieValue);
}

function persistFeatureLibraryValue(value: FeatureLibraryValue) {
  window.localStorage.setItem(FEATURE_LIBRARY_STORAGE_KEY, value);
  Cookies.set(FEATURE_LIBRARY_COOKIE, value, {
    expires: 365,
    sameSite: "None",
    secure: true,
  });
}

export function setFeatureLibraryValue(value: FeatureLibraryValue) {
  if (typeof window === "undefined") {
    return;
  }

  persistFeatureLibraryValue(value);
  window.dispatchEvent(
    new CustomEvent("feature-library-change", { detail: { featureLibrary: value } }),
  );
}

export function useFeatureLibraryEnabled() {
  const searchParams = useSearchParams();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const nextEnabled = readBrowserFeatureLibraryEnabled();
    const searchValue = searchParams.get(FEATURE_LIBRARY_PARAM);
    const storageValue = window.localStorage.getItem(FEATURE_LIBRARY_STORAGE_KEY);
    const cookieValue = Cookies.get(FEATURE_LIBRARY_COOKIE);
    const nextValue = featureLibraryEnabledToValue(nextEnabled);

    if (isFeatureLibraryValue(searchValue)) {
      persistFeatureLibraryValue(searchValue);
    } else if (!isFeatureLibraryValue(storageValue) && !isFeatureLibraryValue(cookieValue)) {
      persistFeatureLibraryValue(nextValue);
    }

    setEnabled(nextEnabled);
  }, [searchParams]);

  useEffect(() => {
    const handleFeatureLibraryChange = (event: Event) => {
      const value = (event as CustomEvent<{ featureLibrary?: unknown }>).detail?.featureLibrary;
      if (!isFeatureLibraryValue(value)) {
        return;
      }

      const nextEnabled = value !== "off";
      setEnabled(nextEnabled);
    };

    window.addEventListener("feature-library-change", handleFeatureLibraryChange);
    return () => window.removeEventListener("feature-library-change", handleFeatureLibraryChange);
  }, []);

  return enabled;
}
