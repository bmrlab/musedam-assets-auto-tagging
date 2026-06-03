export const FEATURE_LIBRARY_PARAM = "featureLibrary";
export const FEATURE_LIBRARY_COOKIE = "featureLibrary";
export const FEATURE_LIBRARY_STORAGE_KEY = "featureLibrary";

export type FeatureLibraryValue = "on" | "off";

const FEATURE_LIBRARY_ROUTES = [
  "/tagging/brand",
  "/tagging/product",
  "/tagging/person",
  "/tagging/ip",
] as const;

export function isFeatureLibraryValue(value: unknown): value is FeatureLibraryValue {
  return value === "on" || value === "off";
}

export function featureLibraryValueToEnabled(value: FeatureLibraryValue | null | undefined) {
  return value === "on";
}

export function featureLibraryEnabledToValue(enabled: boolean): FeatureLibraryValue {
  return enabled ? "on" : "off";
}

export function resolveFeatureLibraryEnabled(
  primaryValue?: string | null,
  fallbackValue?: string | null,
) {
  if (isFeatureLibraryValue(primaryValue)) {
    return featureLibraryValueToEnabled(primaryValue);
  }

  if (isFeatureLibraryValue(fallbackValue)) {
    return featureLibraryValueToEnabled(fallbackValue);
  }

  return false;
}

export function resolveFeatureLibraryValue(
  primaryValue?: string | null,
  fallbackValue?: string | null,
): FeatureLibraryValue {
  return featureLibraryEnabledToValue(resolveFeatureLibraryEnabled(primaryValue, fallbackValue));
}

export function isFeatureLibraryRoute(pathname: string) {
  return FEATURE_LIBRARY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function stripFeatureLibraryRecommendations<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  return {
    ...result,
    brandRecommendation: null,
    ipRecommendation: null,
    productRecommendation: null,
    personRecommendation: null,
  } as T;
}
