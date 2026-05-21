/**
 * Request/response types for POST /api/muse/query-features-by-materials
 */

import type { MuseDAMSaveFeatureType } from "./save-feature-types";

export type MuseDAMMaterialFeatureSnapshot = {
  id: number;
  featureType: MuseDAMSaveFeatureType;
  identifierId: string;
  identifierName: string;
  identifierTypeId: string;
  identifierTypeName: string;
  identifierImagePath: string;
  tagPaths: string[];
  materialCount: number;
};

export type MuseDAMMaterialFeaturesEntry = {
  materialId: number;
  features: MuseDAMMaterialFeatureSnapshot[];
};

/** JSON body sent to MuseDAM query-features-by-materials (excluding team credentials). */
export type QueryFeaturesByMaterialsInput = {
  materialIds: number[];
};

/** Raw success envelope from MuseDAM before `requestMuseDAMAPI` unwraps `result`. */
export type QueryFeaturesByMaterialsApiResponse = {
  code: string;
  message: string;
  result: MuseDAMMaterialFeaturesEntry[];
  traceId?: string;
};

/** Value returned by `requestMuseDAMAPI` for this endpoint (the `result` field only). */
export type QueryFeaturesByMaterialsOutput = QueryFeaturesByMaterialsApiResponse["result"];
