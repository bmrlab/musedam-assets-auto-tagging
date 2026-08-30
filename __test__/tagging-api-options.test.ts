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

  it("requires all four flags when the nested featureToggle object is sent", () => {
    expect(() =>
      apiFeatureToggleRequestSchema.parse({
        featureLibrary: 1,
        featureToggle: {
          featureBrand: 1,
        },
      }),
    ).toThrow();
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
