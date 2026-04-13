export type BrandLogoTypeItem = {
  id: string;
  name: string;
  sort: number;
};

export type BrandTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: BrandTagTreeNode[];
};

export type BrandLogoTagItem = {
  id: string;
  assetTagId: number | null;
  tagPath: string[];
};

export type BrandLogoImageItem = {
  id: string;
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  mimeType: string;
  size: number;
  sort: number;
};

export type BrandLogoItem = {
  id: string;
  slug: string;
  name: string;
  logoTypeId: string | null;
  logoTypeName: string;
  status: "pending" | "processing" | "completed" | "failed";
  processingError: string | null;
  processedAt: Date | null;
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: BrandLogoImageItem[];
  tags: BrandLogoTagItem[];
};

export type BrandLibraryPageData = {
  logos: BrandLogoItem[];
  logoTypes: BrandLogoTypeItem[];
  tags: BrandTagTreeNode[];
};

export type BrandDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type BrandClassificationUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  detections: BrandDetectionBox[];
  found: boolean;
};

export type BrandClassificationMatch = {
  assetLogoId: string;
  logoName: string;
  logoTypeId: string | null;
  logoTypeName: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
};

export type BrandClassificationResult = {
  topMatches: BrandClassificationMatch[];
  bestMatch: BrandClassificationMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};
