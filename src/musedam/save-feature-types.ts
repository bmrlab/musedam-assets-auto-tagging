/**
 * Request/response types for POST /api/muse/save-feature
 */

export type MuseDAMSaveFeatureType = "person" | "brand" | "product" | "ip";

/** JSON body sent to MuseDAM save-feature (excluding team credentials). */
export type SaveFeatureToMuseDAMInput = {
  featureType: MuseDAMSaveFeatureType;
  /** e.g. AssetPerson.id, brand.id */
  identifierId: string;
  identifierName: string;
  /** e.g. AssetPersonType.id */
  identifierTypeId: string;
  identifierTypeName: string;
  /** Permanent public URL from OSS without signing */
  identifierImagePath: string;
  tagIdList: number[];
};

/** Raw success envelope from MuseDAM before `requestMuseDAMAPI` unwraps `result`. */
export type SaveFeatureToMuseDAMApiResponse = {
  code: string;
  message: string;
  result: boolean;
  traceId?: string;
};

/** Value returned by `requestMuseDAMAPI` for this endpoint (the `result` field only). */
export type SaveFeatureToMuseDAMOutput = SaveFeatureToMuseDAMApiResponse["result"];
