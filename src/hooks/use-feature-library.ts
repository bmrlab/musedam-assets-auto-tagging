"use client";

import {
  FEATURE_LIBRARY_TOGGLE_NAMES,
  FeatureLibraryFeatures,
  FeatureLibraryToggleName,
  FeatureLibraryValue,
  isFeatureLibraryValue,
  resolveFeatureLibraryFeatures,
  resolveFeatureLibraryValue,
} from "@/lib/feature-library";
import Cookies from "js-cookie";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const DISABLED_FEATURES: FeatureLibraryFeatures = {
  featureLibrary: false,
  featureBrand: false,
  featureProduct: false,
  featurePerson: false,
  featureIp: false,
};

function getCachedValue(name: FeatureLibraryToggleName) {
  const storedValue = window.localStorage.getItem(name);
  return isFeatureLibraryValue(storedValue) ? storedValue : Cookies.get(name);
}

function readBrowserFeatureLibraryFeatures() {
  const params = new URLSearchParams(window.location.search);
  return resolveFeatureLibraryFeatures(
    Object.fromEntries(FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, params.get(name)])),
    Object.fromEntries(FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, getCachedValue(name)])),
  );
}

function persistFeatureLibraryValue(name: FeatureLibraryToggleName, value: FeatureLibraryValue) {
  window.localStorage.setItem(name, value);
  Cookies.set(name, value, {
    expires: 365,
    sameSite: "None",
    secure: true,
  });
}

export function setFeatureToggleValue(name: FeatureLibraryToggleName, value: FeatureLibraryValue) {
  if (typeof window === "undefined") {
    return;
  }

  persistFeatureLibraryValue(name, value);
  window.dispatchEvent(new CustomEvent("feature-library-change", { detail: { [name]: value } }));
}

export function setFeatureLibraryValue(value: FeatureLibraryValue) {
  setFeatureToggleValue("featureLibrary", value);
}

export function useFeatureLibraryFeatures() {
  const searchParams = useSearchParams();
  const [features, setFeatures] = useState<FeatureLibraryFeatures>(DISABLED_FEATURES);

  useEffect(() => {
    const nextFeatures = readBrowserFeatureLibraryFeatures();

    for (const name of FEATURE_LIBRARY_TOGGLE_NAMES) {
      const searchValue = searchParams.get(name);
      const storageValue = window.localStorage.getItem(name);
      const cookieValue = Cookies.get(name);

      if (isFeatureLibraryValue(searchValue)) {
        persistFeatureLibraryValue(name, searchValue);
      } else if (!isFeatureLibraryValue(storageValue) && !isFeatureLibraryValue(cookieValue)) {
        // Persist the raw default, not the parent-gated effective child value.
        persistFeatureLibraryValue(name, resolveFeatureLibraryValue(searchValue, cookieValue));
      }
    }

    setFeatures(nextFeatures);
  }, [searchParams]);

  useEffect(() => {
    const handleFeatureLibraryChange = () => setFeatures(readBrowserFeatureLibraryFeatures());

    window.addEventListener("feature-library-change", handleFeatureLibraryChange);
    return () => window.removeEventListener("feature-library-change", handleFeatureLibraryChange);
  }, []);

  return features;
}

export function useFeatureLibraryEnabled() {
  return useFeatureLibraryFeatures().featureLibrary;
}
