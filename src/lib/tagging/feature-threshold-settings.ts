import prisma from "@/prisma/prisma";
import "server-only";
import {
  FEATURE_CONFIDENCE_MIN,
  normalizeFeatureThresholds,
  type FeatureThresholds,
} from "./feature-confidence";
export const featureThresholdKey = (type: keyof FeatureThresholds) =>
  `featureConfidenceMin.${type}`;
export async function getFeatureThresholds(teamId: number): Promise<FeatureThresholds> {
  const rows = await prisma.teamConfig.findMany({
    where: {
      teamId,
      key: {
        in: Object.keys(FEATURE_CONFIDENCE_MIN).map((type) =>
          featureThresholdKey(type as keyof FeatureThresholds),
        ),
      },
    },
    select: { key: true, value: true },
  });
  return normalizeFeatureThresholds(
    Object.fromEntries(rows.map((row) => [row.key.split(".")[1], row.value])),
  );
}
