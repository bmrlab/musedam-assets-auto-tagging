export const FEATURE_LIBRARY_PARAM = "featureLibrary";
export const FEATURE_LIBRARY_COOKIE = "featureLibrary";
export const FEATURE_LIBRARY_STORAGE_KEY = "featureLibrary";

export const FEATURE_BRAND_PARAM = "featureBrand";
export const FEATURE_PRODUCT_PARAM = "featureProduct";
export const FEATURE_PERSON_PARAM = "featurePerson";
export const FEATURE_IP_PARAM = "featureIp";

export type FeatureLibraryValue = "on" | "off";
export type FeatureType = "brand" | "product" | "person" | "ip";
export type FeatureLibraryToggleName =
  | typeof FEATURE_LIBRARY_PARAM
  | typeof FEATURE_BRAND_PARAM
  | typeof FEATURE_PRODUCT_PARAM
  | typeof FEATURE_PERSON_PARAM
  | typeof FEATURE_IP_PARAM;

export type FeatureLibraryFeatures = {
  featureLibrary: boolean;
  featureBrand: boolean;
  featureProduct: boolean;
  featurePerson: boolean;
  featureIp: boolean;
};

export type FeatureClassificationFlags = {
  brand: boolean;
  product: boolean;
  person: boolean;
  ip: boolean;
};

export const FEATURE_LIBRARY_TOGGLE_NAMES: readonly FeatureLibraryToggleName[] = [
  FEATURE_LIBRARY_PARAM,
  FEATURE_BRAND_PARAM,
  FEATURE_PRODUCT_PARAM,
  FEATURE_PERSON_PARAM,
  FEATURE_IP_PARAM,
] as const;

export const FEATURE_TOGGLE_BY_TYPE: Record<FeatureType, FeatureLibraryToggleName> = {
  brand: FEATURE_BRAND_PARAM,
  product: FEATURE_PRODUCT_PARAM,
  person: FEATURE_PERSON_PARAM,
  ip: FEATURE_IP_PARAM,
};

const FEATURE_TYPE_BY_ROUTE = {
  "/tagging/brand": "brand",
  "/tagging/product": "product",
  "/tagging/person": "person",
  "/tagging/ip": "ip",
} as const satisfies Record<string, FeatureType>;

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

  return true;
}

export function resolveFeatureLibraryValue(
  primaryValue?: string | null,
  fallbackValue?: string | null,
): FeatureLibraryValue {
  return featureLibraryEnabledToValue(resolveFeatureLibraryEnabled(primaryValue, fallbackValue));
}

type FeatureLibraryValueSource = Partial<Record<FeatureLibraryToggleName, string | null>>;

/** Resolve URL/cached values and enforce that child features require the parent library. */
export function resolveFeatureLibraryFeatures(
  primaryValues: FeatureLibraryValueSource = {},
  fallbackValues: FeatureLibraryValueSource = {},
): FeatureLibraryFeatures {
  const featureLibrary = resolveFeatureLibraryEnabled(
    primaryValues.featureLibrary,
    fallbackValues.featureLibrary,
  );
  const resolveChild = (name: Exclude<FeatureLibraryToggleName, "featureLibrary">) =>
    featureLibrary && resolveFeatureLibraryEnabled(primaryValues[name], fallbackValues[name]);

  return {
    featureLibrary,
    featureBrand: resolveChild("featureBrand"),
    featureProduct: resolveChild("featureProduct"),
    featurePerson: resolveChild("featurePerson"),
    featureIp: resolveChild("featureIp"),
  };
}

export function toFeatureClassificationFlags(
  features: FeatureLibraryFeatures,
): FeatureClassificationFlags {
  return {
    brand: features.featureBrand,
    product: features.featureProduct,
    person: features.featurePerson,
    ip: features.featureIp,
  };
}

/** Normalize queue options. Omitted child values mean enabled for legacy queue compatibility. */
export function resolveFeatureClassificationFlags(
  featureLibrary: boolean,
  features: Partial<FeatureClassificationFlags> = {},
): FeatureClassificationFlags {
  return {
    brand: featureLibrary && features.brand !== false,
    product: featureLibrary && features.product !== false,
    person: featureLibrary && features.person !== false,
    ip: featureLibrary && features.ip !== false,
  };
}

export function isFeatureTypeEnabled(features: FeatureLibraryFeatures, type: FeatureType) {
  return features[FEATURE_TOGGLE_BY_TYPE[type]];
}

export function getFeatureLibraryRouteType(pathname: string): FeatureType | null {
  for (const [route, type] of Object.entries(FEATURE_TYPE_BY_ROUTE)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return type;
    }
  }
  return null;
}

export function isFeatureLibraryRoute(pathname: string) {
  return getFeatureLibraryRouteType(pathname) !== null;
}

export function filterFeatureLibraryRecommendations<T>(
  result: T,
  features: FeatureLibraryFeatures,
): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  return {
    ...result,
    ...(!features.featureBrand ? { brandRecommendation: null } : {}),
    ...(!features.featureIp ? { ipRecommendation: null } : {}),
    ...(!features.featureProduct ? { productRecommendation: null } : {}),
    ...(!features.featurePerson ? { personRecommendation: null } : {}),
  } as T;
}

export function stripFeatureLibraryRecommendations<T>(result: T): T {
  return filterFeatureLibraryRecommendations(result, {
    featureLibrary: false,
    featureBrand: false,
    featureProduct: false,
    featurePerson: false,
    featureIp: false,
  });
}
