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
  detections: PersonDetectionBox[];
  faceCount: number;
  found: boolean;
};

export type PersonClassificationMatch = {
  assetPersonId: string;
  personName: string;
  personTypeId: string | null;
  personTypeName: string;
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
