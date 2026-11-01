import { resolveFeatureLibraryFeatures, toFeatureClassificationFlags } from "@/lib/feature-library";
import {
  apiFeatureToggleRequestSchema,
  apiRecognitionAccuracySchema,
  getExplicitFeatureValuesFromApiRequest,
} from "@/lib/tagging-api-options";
import { describe, expect, it } from "vitest";

describe("tagging API options", () => {
  it("normalizes the nested numeric featureToggle contract for the queue", () => {
    const request = apiFeatureToggleRequestSchema.parse({
      featureLibrary: 1,
      featureToggle: {
        featureBrand: 1,
        featureProduct: 0,
        featurePerson: 1,
        featureIp: 0,
      },
    });

    const features = resolveFeatureLibraryFeatures(getExplicitFeatureValuesFromApiRequest(request));

    expect(features).toEqual({
      featureLibrary: true,
      featureBrand: true,
      featureProduct: false,
      featurePerson: true,
      featureIp: false,
    });
    expect(toFeatureClassificationFlags(features)).toEqual({
      brand: true,
      product: false,
      person: true,
      ip: false,
    });
  });

  it("treats an empty featureToggle and omitted child flags as off", () => {
    const empty = apiFeatureToggleRequestSchema.parse({
      featureLibrary: 1,
      featureToggle: {},
    });
    expect(resolveFeatureLibraryFeatures(getExplicitFeatureValuesFromApiRequest(empty))).toEqual({
      featureLibrary: true,
      featureBrand: false,
      featureProduct: false,
      featurePerson: false,
      featureIp: false,
    });

    const partial = apiFeatureToggleRequestSchema.parse({
      featureLibrary: 1,
      featureBrand: "on",
      featureToggle: {
        featureBrand: 1,
        featureProduct: null,
        featurePerson: "",
      },
    });
    expect(resolveFeatureLibraryFeatures(getExplicitFeatureValuesFromApiRequest(partial))).toEqual({
      featureLibrary: true,
      featureBrand: true,
      featureProduct: false,
      featurePerson: false,
      featureIp: false,
    });
  });

  it("keeps flat fields compatible but gives nested fields precedence", () => {
    const request = apiFeatureToggleRequestSchema.parse({
      featureLibrary: "on",
      featureBrand: "off",
      featureProduct: "on",
      featurePerson: "on",
      featureIp: "on",
      featureToggle: {
        featureBrand: "on",
        featureProduct: "off",
        featurePerson: "off",
        featureIp: "off",
      },
    });

    expect(getExplicitFeatureValuesFromApiRequest(request)).toEqual({
      featureLibrary: "on",
      featureBrand: "on",
      featureProduct: "off",
      featurePerson: "off",
      featureIp: "off",
    });
  });

  it("accepts accurate as an alias of precise", () => {
    expect(apiRecognitionAccuracySchema.parse("accurate")).toBe("precise");
  });
});
