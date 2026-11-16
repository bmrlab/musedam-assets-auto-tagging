import {
  isFeatureLibrarySupportedAsset,
  isVideoAssetExtension,
  VIDEO_EXTENSIONS,
} from "@/lib/feature-library";
import { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { TAGGING_CONFIG_KEYS } from "./types";

/** Aggregate in PostgreSQL so logging never loads the pending queue's asset payloads. */
export async function getPendingQueueLogSummary() {
  const groups = await prisma.$queryRaw<
    {
      teamSlug: string;
      extension: string | null;
      isAsset: boolean;
      featureImageMode: boolean;
      count: number;
    }[]
  >(Prisma.sql`
    WITH pending AS (
      SELECT t."slug" AS "teamSlug", a."id" IS NOT NULL AS "isAsset",
        lower(regexp_replace(COALESCE(NULLIF(btrim(a."extra"->>'extension'), ''),
          substring(a."name" from '[^.]+$')), '^\\.', '')) AS extension,
        q."extra"->'featureImageMode' AS snapshot,
        image_config."value" AS image_mode, video_config."value" AS video_mode
      FROM "TaggingQueueItem" q
      JOIN "Team" t ON t."id" = q."teamId"
      LEFT JOIN "AssetObject" a ON a."id" = q."assetObjectId"
      LEFT JOIN "TeamConfig" image_config ON image_config."teamId" = q."teamId"
        AND image_config."key" = ${TAGGING_CONFIG_KEYS.FEATURE_IMAGE_MODE}
      LEFT JOIN "TeamConfig" video_config ON video_config."teamId" = q."teamId"
        AND video_config."key" = ${TAGGING_CONFIG_KEYS.FEATURE_VIDEO_IMAGE_MODE}
      WHERE q."status" = 'pending'
    ), resolved AS (
      SELECT "teamSlug", "isAsset", extension,
        CASE WHEN jsonb_typeof(snapshot) = 'boolean' THEN snapshot = 'true'::jsonb
          WHEN extension IN (${Prisma.join([...VIDEO_EXTENSIONS])})
            THEN COALESCE(video_mode = 'true'::jsonb, false)
          ELSE COALESCE(image_mode = 'true'::jsonb, false)
        END AS "featureImageMode"
      FROM pending
    )
    SELECT "teamSlug", "isAsset", extension, "featureImageMode", count(*)::int AS count
    FROM resolved GROUP BY "teamSlug", "isAsset", extension, "featureImageMode"
  `);
  const emptyCounts = () => ({
    imageCount: 0,
    videoCount: 0,
    otherCount: 0,
    imageModeEnabledCount: 0,
    imageModeDisabledCount: 0,
    videoImageModeEnabledCount: 0,
    videoImageModeDisabledCount: 0,
  });
  const totals = emptyCounts();
  const teams = new Map<string, ReturnType<typeof emptyCounts> & { pendingTotal: number }>();
  for (const group of groups) {
    const counts = teams.get(group.teamSlug) ?? { ...emptyCounts(), pendingTotal: 0 };
    counts.pendingTotal += group.count;
    teams.set(group.teamSlug, counts);
    const isVideo = group.isAsset && isVideoAssetExtension(group.extension);
    const isImage = group.isAsset && !isVideo && isFeatureLibrarySupportedAsset(group.extension);
    const mediaKey = isVideo ? "videoCount" : isImage ? "imageCount" : "otherCount";
    counts[mediaKey] += group.count;
    totals[mediaKey] += group.count;
    if (isVideo || isImage) {
      const modeKey = isVideo
        ? group.featureImageMode
          ? "videoImageModeEnabledCount"
          : "videoImageModeDisabledCount"
        : group.featureImageMode
          ? "imageModeEnabledCount"
          : "imageModeDisabledCount";
      counts[modeKey] += group.count;
      totals[modeKey] += group.count;
    }
  }
  const sortedTeams = [...teams].sort((a, b) => b[1].pendingTotal - a[1].pendingTotal);
  return {
    pendingTotal: sortedTeams.reduce((sum, [, counts]) => sum + counts.pendingTotal, 0),
    teamCount: teams.size,
    ...totals,
    byTeam: Object.fromEntries(sortedTeams.map(([slug, counts]) => [slug, counts.pendingTotal])),
    mediaByTeam: Object.fromEntries(sortedTeams),
    summary: sortedTeams
      .map(
        ([slug, c]) =>
          `${slug}:${c.pendingTotal}个排队，图片${c.imageCount}（图像模式开${c.imageModeEnabledCount}/关${c.imageModeDisabledCount}），视频${c.videoCount}（图像模式开${c.videoImageModeEnabledCount}/关${c.videoImageModeDisabledCount}），其他${c.otherCount}`,
      )
      .join(", "),
  };
}
