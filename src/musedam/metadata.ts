import type {
  MetadataApplyResult,
  MetadataContext,
  MetadataPrediction,
} from "@/lib/metadata/types";
import "server-only";
import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";

type Team = { id: number; slug: string };
async function call<T>(team: Team, path: `/${string}`, body: unknown): Promise<T> {
  const { apiKey } = await retrieveTeamCredentials({ team });
  return requestMuseDAMAPI<T>(path, {
    method: "POST",
    timeoutMs: 30000,
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
}
const predictionValues = (fields: MetadataPrediction[]) =>
  fields.map(({ fieldId, expectedFieldVersion, optionIds, checked, confidence }) => ({
    fieldId,
    expectedFieldVersion,
    optionIds,
    checked,
    confidence,
  }));
export const fetchMetadataContext = (
  team: Team,
  materialId?: string,
  predictions?: MetadataPrediction[],
) =>
  call<MetadataContext>(team, "/api/muse/metadata-ai-context", {
    materialId,
    ...(predictions ? { predictions: predictionValues(predictions) } : {}),
  });
export const applyMetadataPredictions = (
  team: Team,
  materialId: string,
  fields: MetadataPrediction[],
  requestId: string,
) =>
  call<MetadataApplyResult>(team, "/api/muse/metadata-ai-apply", {
    materialId,
    requestId,
    fields: predictionValues(fields),
  });

/** Existing tag-only teams need no metadata endpoint; field-only teams must still have both entitlements. */
export async function hasEnabledTaggingOutput(
  team: Team,
  settings: { isTaggingEnabled: boolean; isMetadataEnabled: boolean },
) {
  return (
    settings.isTaggingEnabled ||
    (settings.isMetadataEnabled && (await fetchMetadataContext(team)).enabled)
  );
}

/** Existing read-only metadata API; values are keyed by field name. */
export const fetchMetadataValues = (team: Team, materialId: string) =>
  call<Record<string, Record<string, unknown>>>(team, "/api/muse/metadata-records-by-ids", {
    materialIds: [materialId],
  });
