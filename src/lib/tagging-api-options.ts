import type { FeatureLibraryToggleName, FeatureLibraryValue } from "@/lib/feature-library";
import { z } from "zod";

export const apiFeatureToggleValueSchema = z.preprocess(
  (value) => {
    if (typeof value === "number") {
      return value === 1 ? "on" : value === 0 ? "off" : value;
    }
    if (typeof value === "string") {
      if (value === "1") return "on";
      if (value === "0") return "off";
    }
    return value;
  },
  z.enum(["on", "off"]),
);

const optionalApiFeatureToggleValueSchema = apiFeatureToggleValueSchema.optional();

const API_FEATURE_TOGGLE_NAMES = [
  "featureBrand",
  "featureProduct",
  "featurePerson",
  "featureIp",
] as const;

function isMissingFeatureToggleValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

/**
 * When featureToggle is sent, omitted or empty child values are off.
 * An empty object therefore disables all four classifiers.
 * Omitting featureToggle itself keeps the legacy default (enabled).
 */
export const apiFeatureToggleSchema = z.preprocess((value) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    ...record,
    ...Object.fromEntries(
      API_FEATURE_TOGGLE_NAMES.map((name) => [
        name,
        isMissingFeatureToggleValue(record[name]) ? "off" : record[name],
      ]),
    ),
  };
}, z.object({
  featureBrand: apiFeatureToggleValueSchema,
  featureProduct: apiFeatureToggleValueSchema,
  featurePerson: apiFeatureToggleValueSchema,
  featureIp: apiFeatureToggleValueSchema,
}));

/** Shared fields for tagging endpoints. Flat child fields remain for old callers. */
export const apiFeatureToggleRequestSchema = z.object({
  featureLibrary: optionalApiFeatureToggleValueSchema,
  featureToggle: apiFeatureToggleSchema.optional(),
  featureBrand: optionalApiFeatureToggleValueSchema,
  featureProduct: optionalApiFeatureToggleValueSchema,
  featurePerson: optionalApiFeatureToggleValueSchema,
  featureIp: optionalApiFeatureToggleValueSchema,
});

export type ApiFeatureToggleRequest = z.infer<typeof apiFeatureToggleRequestSchema>;

/** Nested values take precedence over the deprecated flat child fields. */
export function getExplicitFeatureValuesFromApiRequest({
  featureLibrary,
  featureToggle,
  featureBrand,
  featureProduct,
  featurePerson,
  featureIp,
}: ApiFeatureToggleRequest): Partial<
  Record<FeatureLibraryToggleName, FeatureLibraryValue | undefined>
> {
  return {
    featureLibrary,
    featureBrand: featureToggle?.featureBrand ?? featureBrand,
    featureProduct: featureToggle?.featureProduct ?? featureProduct,
    featurePerson: featureToggle?.featurePerson ?? featurePerson,
    featureIp: featureToggle?.featureIp ?? featureIp,
  };
}

/** "accurate" is kept as an API alias for the internal "precise" mode. */
export const apiRecognitionAccuracySchema = z.preprocess(
  (value) => (value === "accurate" ? "precise" : value),
  z.enum(["precise", "balanced", "broad"]),
);
