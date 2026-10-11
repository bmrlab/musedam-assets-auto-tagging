import type { LibraryListPage } from "../components/library-list-query";

export type PersonTypeItem = {
  id: string;
  name: string;
  sort: number;
};

export type PersonTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: PersonTagTreeNode[];
};

export type PersonTagItem = {
  id: string;
  assetTagId: number | null;
  tagPath: string[];
};

export type PersonImageItem = {
  id: string;
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  /** 长边 256 的缩略图（列表小图用）；缩略图还没生成时加载会失败，前端退回原图 */
  thumbnailUrl?: string;
  thumbnailUrlExpiresAt?: number;
  mimeType: string;
  size: number;
  sort: number;
};

export type PersonItem = {
  id: string;
  slug: string;
  name: string;
  personTypeId: string | null;
  personTypeName: string;
  status: "pending" | "processing" | "completed" | "failed";
  processingError: string | null;
  processedAt: Date | null;
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: PersonImageItem[];
  tags: PersonTagItem[];
};

export type PersonLibraryPageData = {
  persons: PersonItem[];
  personTypes: PersonTypeItem[];
  tags: PersonTagTreeNode[];
};

/** 列表页首屏数据；list 为默认筛选下的第一页。 */
export type PersonLibraryInitialData = {
  list: LibraryListPage<PersonItem>;
  personTypes: PersonTypeItem[];
  tags: PersonTagTreeNode[];
};

export type PersonBatchImportFailure = {
  rowNumber: number;
  name: string | null;
  message: string;
};

export type PersonBatchImportResult = {
  createdPersons: PersonItem[];
  personTypes: PersonTypeItem[];
  tagTree?: PersonTagTreeNode[];
  missingTagPaths?: string[];
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: PersonBatchImportFailure[];
};

export type PersonBatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type PersonDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
  embedding?: number[];
  embeddingModel?: string;
};

export type PersonClassificationUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  imageWidth: number;
  imageHeight: number;
  detections: PersonDetectionBox[];
  faceCount: number;
  found: boolean;
};

export type PersonClassificationMatch = {
  assetPersonId: string;
  personName: string;
  personTypeId: string | null;
  personTypeName: string;
  rawSimilarity: number;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  supportingReferenceCount: number;
  recommendedTags: PersonTagItem[];
};

export type PersonFaceClassificationResult = {
  detectionIndex: number;
  topMatches: PersonClassificationMatch[];
  bestMatch: PersonClassificationMatch | null;
  noConfidentMatch: boolean;
};

export type PersonClassificationResult = {
  faces: PersonFaceClassificationResult[];
};
