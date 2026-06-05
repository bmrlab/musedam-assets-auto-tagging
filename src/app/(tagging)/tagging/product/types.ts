export type ProductTypeItem = {
  id: string;
  name: string;
  sort: number;
};

export type ProductTagTreeNode = {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  children: ProductTagTreeNode[];
};

export type ProductTagItem = {
  id: string;
  assetTagId: number | null;
  tagPath: string[];
};

export type ProductImageItem = {
  id: string;
  objectKey: string;
  ossBucket: string;
  ossEndpoint: string;
  ossRegion: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  mimeType: string;
  size: number;
  sort: number;
};

export type ProductItem = {
  id: string;
  slug: string;
  name: string;
  productTypeId: string | null;
  productTypeName: string;
  description: string;
  generalCategory: string;
  status: "pending" | "processing" | "completed" | "failed";
  processingError: string | null;
  processedAt: Date | null;
  enabled: boolean;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  images: ProductImageItem[];
  tags: ProductTagItem[];
};

export type ProductLibraryPageData = {
  products: ProductItem[];
  productTypes: ProductTypeItem[];
  tags: ProductTagTreeNode[];
};

export type ProductBatchImportFailure = {
  rowNumber: number;
  name: string | null;
  message: string;
};

export type ProductBatchImportResult = {
  createdProducts: ProductItem[];
  productTypes: ProductTypeItem[];
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: ProductBatchImportFailure[];
};

export type ProductBatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type ProductDetectionBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  label: string;
};

export type ProductClassificationUploadResult = {
  objectKey: string;
  signedUrl: string;
  signedUrlExpiresAt: number;
  detections: ProductDetectionBox[];
  found: boolean;
};

export type ProductClassificationMatch = {
  assetProductId: string;
  productName: string;
  productTypeId: string | null;
  productTypeName: string;
  description: string;
  generalCategory: string;
  similarity: number;
  confidence: number;
  detectionIndex: number;
  imageSimilarity: number;
  descriptionSimilarity: number;
  recommendedTags: ProductTagItem[];
};

export type ProductClassificationResult = {
  topMatches: ProductClassificationMatch[];
  bestMatch: ProductClassificationMatch | null;
  noConfidentMatch: boolean;
  winningDetectionIndex: number | null;
};
