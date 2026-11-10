export type MetadataSource = "basicInfo" | "materializedPath" | "contentAnalysis";
export interface MetadataField {
  fieldId: string;
  fieldVersion: number;
  name: string;
  type: "single_select" | "multiple_select" | "cascade" | "boolean";
  instruction?: string;
  multiple: boolean;
  options: { id: string; label: string }[];
  dependsOn?: string[];
}
export interface MetadataContext {
  enabled: boolean;
  materialId: string;
  version: number;
  fields: MetadataField[];
  rejectedFieldIds?: string[];
}
export type MetadataPrediction = {
  fieldId: string;
  expectedFieldVersion: number;
  fieldName: string;
  optionIds?: string[];
  checked?: boolean;
  labels: string[];
  confidence: number;
  score: number;
  effective: boolean;
  sources: { source: MetadataSource; confidence: number; evidence: string }[];
};
export interface MetadataApplyResult {
  applied: string[];
  skipped: string[];
}
