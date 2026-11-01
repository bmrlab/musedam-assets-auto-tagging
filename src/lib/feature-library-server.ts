import "server-only";

import {
  FEATURE_LIBRARY_TOGGLE_NAMES,
  FeatureLibraryToggleName,
  resolveFeatureLibraryFeatures,
} from "@/lib/feature-library";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

type ExplicitFeatureValues = Partial<Record<FeatureLibraryToggleName, string | null | undefined>>;

export async function getServerFeatureLibraryFeatures() {
  const cookieStore = await cookies();
  return resolveFeatureLibraryFeatures(
    {},
    Object.fromEntries(
      FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, cookieStore.get(name)?.value]),
    ),
  );
}

export async function getServerFeatureLibraryEnabled() {
  return (await getServerFeatureLibraryFeatures()).featureLibrary;
}

export function getFeatureLibraryFeaturesFromRequest(
  request: NextRequest,
  explicitValues: ExplicitFeatureValues = {},
) {
  return resolveFeatureLibraryFeatures(
    Object.fromEntries(
      FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [
        name,
        explicitValues[name] ?? request.nextUrl.searchParams.get(name),
      ]),
    ),
    Object.fromEntries(
      FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, request.cookies.get(name)?.value]),
    ),
  );
}

export function getFeatureLibraryEnabledFromRequest(
  request: NextRequest,
  explicitValue?: string | null,
) {
  return getFeatureLibraryFeaturesFromRequest(request, {
    featureLibrary: explicitValue,
  }).featureLibrary;
}
