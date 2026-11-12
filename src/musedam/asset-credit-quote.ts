import "server-only";
import { z } from "zod";
import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";
import { MuseDAMID } from "./types";

const assetsSchema = z.array(
  z.object({
    id: z.coerce.string(),
    name: z.string().optional(),
    extension: z.string().nullish(),
    duration: z.number().nullish(),
  }),
);

/** Read metadata only: quotation must never synchronize assets or enqueue work. */
export async function fetchAssetCreditInputs(
  team: { id: number; slug: string },
  assetIds: bigint[],
) {
  if (!assetIds.length) return [];
  const { apiKey } = await retrieveTeamCredentials({ team });
  const assets = assetsSchema.parse(
    await requestMuseDAMAPI("/api/muse/assets-by-ids", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: assetIds.map((id) => new MuseDAMID(id)),
      timeoutMs: 30_000,
    }),
  );
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return assetIds.map((id) => {
    const asset = byId.get(id.toString());
    if (!asset) throw new Error("A requested asset is unavailable for credit quotation");
    return { name: asset.name, extra: { extension: asset.extension, duration: asset.duration } };
  });
}
