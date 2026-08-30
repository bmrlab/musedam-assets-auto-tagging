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

/**
 * All child toggles are required when featureToggle is provided. This avoids
 * unexpectedly running a classifier because its toggle was accidentally omitted.
 */
export const apiFeatureToggleSchema = z.object({
  featureBrand: apiFeatureToggleValueSchema,
  featureProduct: apiFeatureToggleValueSchema,
  featurePerson: apiFeatureToggleValueSchema,
  featureIp: apiFeatureToggleValueSchema,
});

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
