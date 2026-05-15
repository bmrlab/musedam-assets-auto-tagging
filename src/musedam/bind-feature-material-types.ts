/**
 * Request/response types for POST /api/muse/bind-feature-material
 */

/** JSON body sent to MuseDAM bind-feature-material (excluding team credentials). */
export type MuseDAMBindFeatureMaterialInputBody = {
  /** Feature id in our system, e.g. AssetProduct.id, AssetPerson.id (UUID string). */
  identifierId: string;
  /** MuseDAM asset / material id. */
  materialId: number;
};

/** Raw success envelope from MuseDAM before `requestMuseDAMAPI` unwraps `result`. */
export type MuseDAMBindFeatureMaterialApiResponse = {
  code: string;
  message: string;
  result: boolean;
  traceId?: string;
};

/** Value returned by `requestMuseDAMAPI` for this endpoint (the `result` field only). */
export type MuseDAMBindFeatureMaterialOutput = MuseDAMBindFeatureMaterialApiResponse["result"];
