export type IpTypeItem = {
  id: string;
  name: string;
  sort: number;
};

export type IpTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: IpTagTreeNode[];
};

export type IpTagItem = {
  id: string;
  assetTagId: number | null;
  tagPath: string[];
};

export type IpImageItem = {
  id: string;
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  mimeType: string;
  size: number;
  sort: number;
  partialMatchPatternName: string | null;
  cropXMin: number | null;
  cropYMin: number | null;
  cropXMax: number | null;
  cropYMax: number | null;
  cropImageWidth: number | null;
  cropImageHeight: number | null;
  cropSource: string | null;
  cropDetectionLabel: string | null;
  cropDetectionScore: number | null;
};

export type IpItem = {
  id: string;
  slug: string;
  name: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  matchPattern: "whole" | "partial";
  status: "pending" | "processing" | "completed" | "failed";
  processingError: string | null;
  processedAt: Date | null;
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: IpImageItem[];
  tags: IpTagItem[];
};

export type IpLibraryPageData = {
  ips: IpItem[];
  ipTypes: IpTypeItem[];
  tags: IpTagTreeNode[];
};

export type IpBatchImportFailure = {
  rowNumber: number;
  name: string | null;
  message: string;
};

export type IpBatchImportResult = {
  createdIps: IpItem[];
  ipTypes: IpTypeItem[];
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: IpBatchImportFailure[];
};

export type IpBatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type IpDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type IpClassificationUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  detections: IpDetectionBox[];
  found: boolean;
};

export type IpPartialFeatureDetectionResult = {
  signedUrl: string;
  signedUrlExpiresAt: number;
  imageWidth: number;
  imageHeight: number;
  detections: IpDetectionBox[];
  found: boolean;
};

export type IpClassificationMatch = {
  assetIpId: string;
  ipName: string;
  ipTypeId: string | null;
  ipTypeName: string;
  description: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: IpTagItem[];
};

export type IpClassificationResult = {
  topMatches: IpClassificationMatch[];
  bestMatch: IpClassificationMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};
