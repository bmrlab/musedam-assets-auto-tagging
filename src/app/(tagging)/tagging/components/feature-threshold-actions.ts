"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { FEATURE_CONFIDENCE_MIN, type FeatureType } from "@/lib/tagging/feature-confidence";
import {
  featureThresholdKey,
  getFeatureThresholds,
} from "@/lib/tagging/feature-threshold-settings";
import prisma from "@/prisma/prisma";
export async function fetchFeatureThreshold(type: FeatureType) {
  return withAuth(async ({ team }) => {
    if (!Object.hasOwn(FEATURE_CONFIDENCE_MIN, type)) throw new Error("Invalid feature type");
    return (await getFeatureThresholds(team.id))[type];
  });
}
export async function saveFeatureThreshold(type: FeatureType, value: number) {
  return withAuth(async ({ team }) => {
    if (
      !Object.hasOwn(FEATURE_CONFIDENCE_MIN, type) ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    )
      throw new Error("Invalid feature threshold");
    const key = featureThresholdKey(type);
    await prisma.teamConfig.upsert({
      where: { teamId_key: { teamId: team.id, key } },
      create: { teamId: team.id, key, value },
      update: { value },
    });
    return value;
  });
}
