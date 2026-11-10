import { SECONDARY_FACE_SIM_THRESHOLD } from "@/lib/person/person-match-policy";
import { FEATURE_CONFIDENCE_MIN } from "@/lib/tagging/feature-confidence";
import { Prisma } from "@/prisma/client";

export type ReviewContent = "all" | "tags" | "features" | "fields";
export type ReviewStatus = "all" | "pending" | "approved" | "rejected" | "unmatched";
export type UnmatchedFilters = {
  content: ReviewContent;
  time: "all" | "today" | "week" | "month";
  search: string;
};
export type UnmatchedCapabilities = {
  fields: boolean;
  brand: boolean;
  ip: boolean;
  product: boolean;
  person: boolean;
};

/** Derive an outcome from the last real execution, never from rejected audit rows. */
export function unmatchedQuery(
  teamId: number,
  filters: UnmatchedFilters,
  capabilities: UnmatchedCapabilities,
  page: number,
  pageSize: number,
  count = false,
  now = new Date(),
): Prisma.Sql {
  if (
    !Number.isSafeInteger(teamId) ||
    teamId <= 0 ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    ![20, 40, 80].includes(pageSize) ||
    !["all", "tags", "features", "fields"].includes(filters.content) ||
    !["all", "today", "week", "month"].includes(filters.time) ||
    typeof filters.search !== "string" ||
    filters.search.length > 200
  )
    throw new Error("Invalid query");

  const eligibleTags = Prisma.sql`COALESCE(q."result"->'outputTypes'->'tags' = 'true'::jsonb, jsonb_typeof(q."result"->'predictions') = 'object')`;
  // Older metadata jobs already record this key only when metadata filling was enabled.
  const eligibleFields = Prisma.sql`${capabilities.fields} AND COALESCE(q."result"->'outputTypes'->'fields' = 'true'::jsonb, q."result" ? 'metadataPredictions')`;
  const featureKeys = (["brand", "ip", "product", "person"] as const).filter(
    (key) => capabilities[key],
  );
  const historicalFeatureResults = featureKeys.map(key => Prisma.sql`jsonb_typeof(q."result"->${`${key}Recommendation`}) = 'object'`);
  const eligibleFeatures = featureKeys.length
    ? Prisma.sql`COALESCE(q."result"->'outputTypes'->'features' = 'true'::jsonb,
        (q."result"->'featureDecision'->'decision'->>'status' = 'completed'
        AND NOT (q."result"->'featureDecision'->'decision' ? 'error'))
        OR ${Prisma.join(historicalFeatureResults, " OR ")})`
    : Prisma.sql`false`;
  const tagsMatched = Prisma.sql`jsonb_path_exists(q."result", '$.tagsWithScore[*] ? (@.leafTagId != null && @.tagPath.size() > 0)')`;
  const fieldsMatched = Prisma.sql`jsonb_path_exists(q."result", '$.metadataPredictions[*] ? (@.effective == true)')`;
  const featureMatches = featureKeys.map((key) => {
    const recommendation = Prisma.sql`q."result"->${`${key}Recommendation`}`;
    const threshold = Prisma.sql`CASE WHEN jsonb_typeof(${recommendation}->'confidenceThreshold') = 'number'
      THEN (${recommendation}->>'confidenceThreshold')::numeric ELSE ${FEATURE_CONFIDENCE_MIN[key]} END`;
    const normalizedConfidence = (
      match: Prisma.Sql,
    ) => Prisma.sql`CASE WHEN jsonb_typeof(${match}->'confidence') = 'number'
      THEN GREATEST(0, LEAST(100, ROUND((${match}->>'confidence')::numeric))) ELSE 0 END`;
    if (key === "person") {
      const best = Prisma.sql`face.value->'bestMatch'`;
      const top = Prisma.sql`face.value->'topMatches'->0`;
      return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(${recommendation}->'faces') = 'array' THEN ${recommendation}->'faces' ELSE '[]'::jsonb END
      ) face WHERE ${best}->>'assetPersonId' IS NOT NULL
        AND (${top}->>'assetPersonId' IS NULL OR ${top}->>'assetPersonId' = ${best}->>'assetPersonId')
        AND CASE WHEN jsonb_typeof(${top}->'rawSimilarity') = 'number' THEN (${top}->>'rawSimilarity')::numeric
          WHEN jsonb_typeof(${top}->'similarity') = 'number' THEN (${top}->>'similarity')::numeric - 0.045 ELSE -1 END >= ${SECONDARY_FACE_SIM_THRESHOLD}
        AND ${normalizedConfidence(best)} >= ${threshold})`;
    }
    const idKey = key === "brand" ? "assetLogoId" : key === "ip" ? "assetIpId" : "assetProductId";
    const regions = Prisma.sql`CASE WHEN jsonb_typeof(${recommendation}->'detections') = 'array' THEN ${recommendation}->'detections' ELSE '[]'::jsonb END`;
    const regionMatches = Prisma.sql`CASE WHEN jsonb_typeof(region.value->'topMatches') = 'array' THEN region.value->'topMatches' ELSE '[]'::jsonb END`;
    const membership =
      key === "product"
        ? Prisma.sql`AND jsonb_typeof(match.value->'confidence') = 'number' AND (
      match.value->>'matchingSource' = 'assetName'
      OR jsonb_array_length(${regions}) = 0
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(${regions}) region WHERE
        CASE WHEN jsonb_array_length(${regionMatches}) > 0
        THEN EXISTS (SELECT 1 FROM jsonb_array_elements(${regionMatches}) candidate WHERE candidate.value->>'assetProductId' = match.value->>'assetProductId')
        ELSE match.value->'detectionIndex' = region.value->'detectionIndex'
          OR COALESCE(match.value->'detectionIndices', '[]'::jsonb) @> jsonb_build_array(region.value->'detectionIndex') END)
    )`
        : Prisma.empty;
    // The stored array is authoritative, including an empty array. A historical bestMatch is only a fallback.
    return Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(${recommendation}->'matches') = 'array' THEN ${recommendation}->'matches'
      ELSE jsonb_build_array(${recommendation}->'bestMatch') END
    ) match WHERE COALESCE(match.value->>${idKey}, '') <> ''
      AND ${normalizedConfidence(Prisma.sql`match.value`)} >= ${threshold} ${membership})`;
  });
  const featuresMatched = featureMatches.length
    ? Prisma.sql`(${Prisma.join(featureMatches, " OR ")})`
    : Prisma.sql`false`;
  const types = {
    tags: { eligible: eligibleTags, matched: tagsMatched },
    fields: { eligible: eligibleFields, matched: fieldsMatched },
    features: { eligible: eligibleFeatures, matched: featuresMatched },
  };
  const selected = filters.content === "all" ? Object.values(types) : [types[filters.content]];
  const enabled = selected.map((type) => Prisma.sql`COALESCE((${type.eligible}), false)`);
  const matched = selected.map(
    (type) => Prisma.sql`(COALESCE((${type.eligible}), false) AND ${type.matched})`,
  );
  const conditions = [
    Prisma.sql`q."status" = 'completed'`,
    Prisma.sql`NOT (q."result" ? 'error')`,
    Prisma.sql`(${Prisma.join(enabled, " OR ")})`,
    Prisma.sql`NOT (${Prisma.join(matched, " OR ")})`,
    Prisma.sql`NOT COALESCE((o."extra"->>'reviewAssetDeleted')::boolean, false)`,
  ];
  // An incomplete feature decision is unknown, rather than evidence of no match.
  if (featureKeys.length && (filters.content === "all" || filters.content === "features")) {
    conditions.push(Prisma.sql`NOT (
      COALESCE(q."result"->'featureDecision'->>'mode', '') <> 'legacy' AND (
        jsonb_path_exists(q."result", '$.featureDecision.decision ? (@.status == "failed" || (@.status == "completed" && @.error != null && @.error != ""))')
        OR jsonb_path_exists(q."result", '$.featureDecision.decision.batches[*] ? (@.status == "failed")')
        OR jsonb_path_exists(q."result", '$.featureDecision.retrieval ? (@.errors.size() > 0 || @.unassessedCandidates.size() > 0)')
      ))`);
  }
  if (filters.time !== "all") {
    const since = new Date(now);
    if (filters.time === "week") since.setDate(since.getDate() - since.getDay());
    else if (filters.time === "month") since.setDate(1);
    since.setHours(0, 0, 0, 0);
    conditions.push(Prisma.sql`q."createdAt" >= ${since}`);
  }
  if (filters.search.trim()) {
    const search = `%${filters.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      Prisma.sql`(o."name" ILIKE ${search} OR o."description" ILIKE ${search} OR o."materializedPath" ILIKE ${search} OR o."tags"::text ILIKE ${search})`,
    );
  }
  return Prisma.sql`WITH latest AS (
    SELECT DISTINCT ON ("assetObjectId") * FROM "TaggingQueueItem"
    WHERE "teamId" = ${teamId} AND "assetObjectId" IS NOT NULL
      AND "taskType" <> 'test' AND COALESCE("extra"->>'jobKind', '') <> 'tag-tree-generation'
    ORDER BY "assetObjectId", COALESCE("startsAt", "createdAt") DESC, "id" DESC
  ), eligible AS (
    SELECT q."id" AS "queueId", q."assetObjectId", q."createdAt"
    FROM latest q JOIN "AssetObject" o ON o."id" = q."assetObjectId" AND o."teamId" = ${teamId}
    WHERE ${Prisma.join(conditions, " AND ")}
  ) ${
    count
      ? Prisma.sql`SELECT COUNT(*)::integer AS total FROM eligible`
      : Prisma.sql`SELECT * FROM eligible ORDER BY "createdAt" DESC, "queueId" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
  }`;
}
