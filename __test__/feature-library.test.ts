import {
  filterFeatureLibraryRecommendations,
  resolveFeatureClassificationFlags,
  resolveFeatureLibraryFeatures,
  toFeatureClassificationFlags,
} from "@/lib/feature-library";
import { describe, expect, it } from "vitest";

describe("feature library toggles", () => {
  it("keeps the existing all-enabled default", () => {
    expect(resolveFeatureLibraryFeatures()).toEqual({
      featureLibrary: true,
      featureBrand: true,
      featureProduct: true,
      featurePerson: true,
      featureIp: true,
    });
  });

  it("allows each child feature to be enabled independently", () => {
    const features = resolveFeatureLibraryFeatures({
      featureLibrary: "on",
      featureBrand: "on",
      featureProduct: "off",
      featurePerson: "off",
      featureIp: "off",
    });

    expect(toFeatureClassificationFlags(features)).toEqual({
      brand: true,
      product: false,
      person: false,
      ip: false,
    });
  });

  it("gates every child feature when the library is off", () => {
    expect(
      resolveFeatureLibraryFeatures(
        { featureLibrary: "off", featureBrand: "on" },
        {
          featureProduct: "on",
          featurePerson: "on",
          featureIp: "on",
        },
      ),
    ).toEqual({
      featureLibrary: false,
      featureBrand: false,
      featureProduct: false,
      featurePerson: false,
      featureIp: false,
    });
  });

  it("normalizes queue flags and keeps old queue items compatible", () => {
    expect(resolveFeatureClassificationFlags(true)).toEqual({
      brand: true,
      product: true,
      person: true,
      ip: true,
    });
    expect(resolveFeatureClassificationFlags(true, { brand: true, person: false })).toEqual({
      brand: true,
      product: true,
      person: false,
      ip: true,
    });
    expect(resolveFeatureClassificationFlags(false, { brand: true })).toEqual({
      brand: false,
      product: false,
      person: false,
      ip: false,
    });
  });

  it("prefers URL values over cached values", () => {
    expect(
      resolveFeatureLibraryFeatures(
        { featureLibrary: "on", featureBrand: "on" },
        { featureBrand: "off", featureProduct: "off" },
      ),
    ).toMatchObject({
      featureBrand: true,
      featureProduct: false,
    });
  });

  it("removes only disabled recommendations", () => {
    const result = {
      predictions: ["ai"],
      brandRecommendation: { id: "brand" },
      productRecommendation: { id: "product" },
      personRecommendation: { id: "person" },
      ipRecommendation: { id: "ip" },
    };

    expect(
      filterFeatureLibraryRecommendations(
        result,
        resolveFeatureLibraryFeatures({
          featureLibrary: "on",
          featureBrand: "on",
          featureProduct: "off",
          featurePerson: "off",
          featureIp: "off",
        }),
      ),
    ).toEqual({
      predictions: ["ai"],
      brandRecommendation: { id: "brand" },
      productRecommendation: null,
      personRecommendation: null,
      ipRecommendation: null,
    });
  });
});
